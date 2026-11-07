//! What the shell integration says (packages/shell/apps/terminal/integration):
//! the folder (OSC 7) and each command's steps (OSC 133: the prompt, the
//! input, the output, the end and how it ended). libghostty-vt parses them
//! and calls back; this keeps a mark on each command's prompt row (tracked,
//! so it moves with the scrollback), tells the app what happened, and puts
//! the marks in view in each frame. ❖↑ and ❖↓ jump between prompts, and a
//! press on a mark selects that command's output.

use std::collections::VecDeque;

use crate::ffi_generated as ffi;
use crate::integration;
use crate::protocol::{Mark, Output};
use crate::vt::{Vt, sized, sized_free};

/// A step of a command, as libghostty-vt reported it (only valid between
/// the callback and the next `drain`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Step {
    /// A primary prompt started (continuation and right prompts are not commands).
    Prompt,
    Input,
    Output(String),
    End(Option<i32>),
}

/// How many commands keep their mark; older ones lose it.
const KEPT: usize = 2000;

/// A command's prompt row, tracked through the scrollback.
pub(crate) struct CommandMark {
    at: ffi::GhosttyTrackedGridRef,
    /// The command ran (an Enter on an empty prompt starts none).
    ran: bool,
    failed: bool,
}

#[derive(Default)]
pub(crate) struct Marks {
    list: VecDeque<CommandMark>,
}

impl Drop for Marks {
    fn drop(&mut self) {
        for mark in self.list.drain(..) {
            // SAFETY: each ref was made by ghostty_terminal_grid_ref_track and is freed once.
            unsafe { ffi::ghostty_tracked_grid_ref_free(mark.at) };
        }
    }
}

fn point(tag: ffi::GhosttyPointTag, x: u16, y: u32) -> ffi::GhosttyPoint {
    let mut point: ffi::GhosttyPoint = sized_free();
    point.tag = tag;
    point.value.coordinate = ffi::GhosttyPointCoordinate { x, y };
    point
}

impl Vt {
    /// What the shell said in the last piece of output, now that the
    /// terminal has drawn it: marks move to where the cursor is, and the app
    /// hears of the folder and the command's steps (`outbox`).
    pub(crate) fn after_piece(&mut self) {
        if self.hooks.pwd_changed.replace(false)
            && let Some(uri) = self.pwd()
        {
            // An empty OSC 7 clears it; there is nothing to say then.
            if let Some((path, host)) = integration::folder(&uri) {
                self.outbox.push(Output::Cwd { path, host });
            }
        }
        let steps: Vec<Step> = self.hooks.steps.borrow_mut().drain(..).collect();
        for step in steps {
            self.take_step(step);
        }
    }

    fn take_step(&mut self, step: Step) {
        match step {
            Step::Prompt => {
                self.mark_cursor_row(true);
                self.outbox.push(Output::Prompt);
            }
            // The command is typed where the prompt ends (a prompt can take two rows).
            Step::Input => self.mark_cursor_row(false),
            Step::Output(command) => {
                if let Some(mark) = self.marks.list.back_mut() {
                    mark.ran = true;
                }
                self.outbox.push(Output::Command { command });
            }
            Step::End(code) => {
                if let Some(mark) = self.marks.list.back_mut().filter(|mark| mark.ran) {
                    mark.failed = code.is_some_and(|code| code != 0);
                }
                self.outbox.push(Output::Done { code });
            }
        }
    }

    /// The last mark moves to the cursor's row while its command hasn't run;
    /// a new prompt after a command that ran gets a mark of its own.
    fn mark_cursor_row(&mut self, new_prompt: bool) {
        let mut y: u16 = 0;
        // SAFETY: a live terminal; CURSOR_Y is a uint16_t in the active area.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_CURSOR_Y,
                (&mut y as *mut u16).cast(),
            );
        }
        let at = point(ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_ACTIVE, 0, y.into());
        if let Some(last) = self.marks.list.back().filter(|mark| !mark.ran) {
            // SAFETY: the ref is ours and was made by this terminal.
            unsafe { ffi::ghostty_tracked_grid_ref_set(last.at, self.term, at) };
            return;
        }
        if !new_prompt {
            return;
        }
        let mut tracked: ffi::GhosttyTrackedGridRef = std::ptr::null_mut();
        // SAFETY: a live terminal; on success `tracked` is a new ref we own (freed in Marks' drop or below).
        let made = unsafe { ffi::ghostty_terminal_grid_ref_track(self.term, at, &mut tracked) };
        if made != ffi::GhosttyResult_GHOSTTY_SUCCESS || tracked.is_null() {
            return;
        }
        self.marks.list.push_back(CommandMark {
            at: tracked,
            ran: false,
            failed: false,
        });
        while self.marks.list.len() > KEPT {
            if let Some(old) = self.marks.list.pop_front() {
                // SAFETY: ours, freed once.
                unsafe { ffi::ghostty_tracked_grid_ref_free(old.at) };
            }
        }
    }

    /// The commands' marks on rows `top..top + rows` of the screen (the view),
    /// as view rows; none while a program has the alternate screen.
    pub(crate) fn marks_in_view(&self, top: u64, rows: u64) -> Vec<Mark> {
        if self.alternate_screen() {
            return Vec::new();
        }
        let mut seen = Vec::new();
        for mark in self.marks.list.iter().rev().filter(|mark| mark.ran) {
            let Some(y) = screen_row(mark.at) else {
                continue;
            };
            // Older marks are higher up: none of them is in view either.
            if y < top {
                break;
            }
            if y < top + rows {
                seen.push(Mark {
                    y: (y - top) as u16,
                    failed: mark.failed,
                });
            }
        }
        seen.reverse();
        seen
    }

    /// Scroll so the prompt `prompts` away from the view's top is at it (❖↑ -1, ❖↓ 1).
    pub(crate) fn jump(&mut self, prompts: i32) {
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT;
        how.value.delta_prompt = prompts as isize;
        // SAFETY: a live terminal and a filled tagged union.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
    }

    /// Select the output of the command marked on view row `y`.
    pub(crate) fn select_output(&mut self, y: u16) {
        let row = self.viewport_top() + u64::from(y);
        if !self
            .marks
            .list
            .iter()
            .any(|mark| mark.ran && screen_row(mark.at) == Some(row))
        {
            return;
        }
        // The output starts on the row after the command; the prompt itself isn't output.
        let below = point(
            ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_SCREEN,
            0,
            (row + 1) as u32,
        );
        let mut at = sized!(ffi::GhosttyGridRef);
        let mut selection = sized!(ffi::GhosttySelection);
        // SAFETY: a live terminal; `at` and `selection` are sized out values used before the next write.
        unsafe {
            if ffi::ghostty_terminal_grid_ref(self.term, below, &mut at)
                == ffi::GhosttyResult_GHOSTTY_SUCCESS
                && ffi::ghostty_terminal_select_output(self.term, at, &mut selection)
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS
            {
                ffi::ghostty_terminal_set(
                    self.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_SELECTION,
                    (&selection as *const ffi::GhosttySelection).cast(),
                );
            }
        }
    }

    /// The view's first row, in screen coordinates.
    fn viewport_top(&self) -> u64 {
        let mut bar = ffi::GhosttyTerminalScrollbar {
            total: 0,
            offset: 0,
            len: 0,
        };
        // SAFETY: a live terminal; SCROLLBAR is a GhosttyTerminalScrollbar.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SCROLLBAR,
                (&mut bar as *mut ffi::GhosttyTerminalScrollbar).cast(),
            );
        }
        bar.offset
    }

    pub(crate) fn alternate_screen(&self) -> bool {
        let mut screen: ffi::GhosttyTerminalScreen = 0;
        // SAFETY: a live terminal; ACTIVE_SCREEN is a GhosttyTerminalScreen.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN,
                (&mut screen as *mut ffi::GhosttyTerminalScreen).cast(),
            );
        }
        screen == ffi::GhosttyTerminalScreen_GHOSTTY_TERMINAL_SCREEN_ALTERNATE
    }

    /// The folder the shell last named (OSC 7), as it sent it.
    fn pwd(&self) -> Option<String> {
        let mut pwd = ffi::GhosttyString {
            ptr: std::ptr::null(),
            len: 0,
        };
        // SAFETY: a live terminal; the borrowed string is copied before the next terminal call.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_PWD,
                (&mut pwd as *mut ffi::GhosttyString).cast(),
            );
            if pwd.ptr.is_null() || pwd.len == 0 {
                return None;
            }
            Some(String::from_utf8_lossy(std::slice::from_raw_parts(pwd.ptr, pwd.len)).into_owned())
        }
    }
}

/// A tracked mark's row in screen coordinates (the scrollback's top is 0),
/// or None once its row has left the scrollback.
fn screen_row(at: ffi::GhosttyTrackedGridRef) -> Option<u64> {
    let mut out = ffi::GhosttyPointCoordinate { x: 0, y: 0 };
    // SAFETY: the ref is live (owned by Marks); `out` is one coordinate.
    let result = unsafe {
        ffi::ghostty_tracked_grid_ref_point(
            at,
            ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_SCREEN,
            &mut out,
        )
    };
    (result == ffi::GhosttyResult_GHOSTTY_SUCCESS).then_some(u64::from(out.y))
}

/// `bytes` cut after each BEL and each ST (`ESC \`): the ends of OSC
/// sequences, so the terminal can be asked where its cursor is right after
/// each mark. `esc_before`: the last piece ended with ESC.
pub(crate) fn pieces(bytes: &[u8], esc_before: bool) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start = 0;
    for (at, byte) in bytes.iter().enumerate() {
        let st = *byte == b'\\'
            && if at == 0 {
                esc_before
            } else {
                bytes[at - 1] == 0x1b
            };
        if *byte == 0x07 || st {
            out.push(&bytes[start..=at]);
            start = at + 1;
        }
    }
    if start < bytes.len() {
        out.push(&bytes[start..]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_is_cut_after_each_sequence_end() {
        let bytes = b"a\x1b]133;A\x07b\x1b]7;file:///\x1b\\c";
        assert_eq!(
            pieces(bytes, false),
            vec![
                &b"a\x1b]133;A\x07"[..],
                &b"b\x1b]7;file:///\x1b\\"[..],
                &b"c"[..]
            ]
        );
        assert_eq!(pieces(b"\\rest", true), vec![&b"\\"[..], &b"rest"[..]]);
        assert_eq!(pieces(b"\\rest", false), vec![&b"\\rest"[..]]);
        assert!(pieces(b"", false).is_empty());
    }

    /// What zsh with Dashi's integration prints around one command.
    fn command(line: &str, status: i32) -> Vec<u8> {
        format!(
            "\x1b]133;A\x07$ \x1b]133;B\x07{line}\r\n\x1b]133;C;cmdline_url={line}\x07out\r\n\x1b]133;D;{status}\x07"
        )
        .into_bytes()
    }

    fn said(vt: &mut Vt) -> Vec<String> {
        vt.take_outbox()
            .iter()
            .map(|message| serde_json::to_string(message).expect("json"))
            .collect()
    }

    #[test]
    fn the_shell_says_its_folder_and_each_command() {
        let mut vt = Vt::new(20, 6, -1).expect("a terminal");
        vt.feed(b"\x1b]7;file://dashi/home/alexk/My%20Files\x07");
        vt.feed(&command("false", 1));
        assert_eq!(
            said(&mut vt),
            vec![
                r#"{"t":"cwd","path":"/home/alexk/My Files","host":"dashi"}"#,
                r#"{"t":"prompt"}"#,
                r#"{"t":"command","command":"false"}"#,
                r#"{"t":"done","code":1}"#,
            ]
        );
    }

    #[test]
    fn a_failed_command_is_marked_on_its_row() {
        let mut vt = Vt::new(20, 8, -1).expect("a terminal");
        // An empty Enter first: a prompt with no command gets no mark.
        vt.feed(b"\x1b]133;A\x07$ \x1b]133;B\x07\r\n");
        vt.feed(&command("true", 0));
        vt.feed(&command("false", 1));
        vt.feed(b"\x1b]133;A\x07$ \x1b]133;B\x07");
        let frame = vt.frame(true).expect("a frame");
        assert_eq!(
            frame.marks,
            vec![
                Mark {
                    y: 1,
                    failed: false
                },
                Mark { y: 3, failed: true }
            ]
        );
    }

    #[test]
    fn marks_follow_the_scrollback_and_prompts_can_be_jumped_to() {
        let mut vt = Vt::new(20, 4, -1).expect("a terminal");
        vt.feed(&command("false", 2));
        for _ in 0..10 {
            vt.feed(b"line\r\n");
        }
        vt.feed(b"\x1b]133;A\x07$ \x1b]133;B\x07");
        // Ten lines later the failed command is in the scrollback, not in view.
        assert!(vt.frame(true).expect("a frame").marks.is_empty());
        vt.jump(-1);
        let frame = vt.frame(true).expect("a frame");
        assert_eq!(frame.marks, vec![Mark { y: 0, failed: true }]);
        vt.select_output(0);
        assert!(vt.has_selection());
        assert!(vt.copy().starts_with("out"), "{}", vt.copy());
    }
}
