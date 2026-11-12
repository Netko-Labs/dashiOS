//! What the shell integration says (packages/shell/apps/terminal/integration):
//! the folder (OSC 7) and each command's steps (OSC 133: the prompt, the
//! input, the output, the end and how it ended). libghostty-vt parses them
//! and calls back; this keeps a mark on each command's prompt row (tracked,
//! so it moves with the scrollback), tells the app what happened, and puts
//! the marks in view in each frame. ❖↑ and ❖↓ jump between prompts, and a
//! press on a mark selects that command's output.

mod pieces;
mod view;

use std::collections::VecDeque;

use crate::ffi_generated as ffi;
use crate::integration;
use crate::protocol::Output;
use crate::vt::{Vt, sized_free};

pub(crate) use pieces::pieces;

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
}

#[cfg(test)]
mod tests;
