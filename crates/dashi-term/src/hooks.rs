//! libghostty-vt's callbacks: the terminal's replies go to the PTY, and
//! what the program or the shell said (a title, the bell, a folder, a
//! command's step) is noted for the main loop to pass on. They run inside
//! `ghostty_terminal_vt_write`, so they only note; `vt.rs` and `marks.rs`
//! act once the write returns.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::os::fd::RawFd;

use crate::ffi_generated as ffi;
use crate::marks::Step;
use crate::pty;

/// What the terminal's callbacks reach: the PTY, and what happened.
pub(crate) struct Hooks {
    pub(crate) fd: RawFd,
    pub(crate) title_changed: Cell<bool>,
    pub(crate) bell: Cell<bool>,
    /// The shell named its folder (OSC 7).
    pub(crate) pwd_changed: Cell<bool>,
    /// The shell's command steps (OSC 133) since `marks.rs` last took them.
    pub(crate) steps: RefCell<Vec<Step>>,
}

impl Hooks {
    pub(crate) fn new(fd: RawFd) -> Hooks {
        Hooks {
            fd,
            title_changed: Cell::new(false),
            bell: Cell::new(false),
            pwd_changed: Cell::new(false),
            steps: RefCell::new(Vec::new()),
        }
    }
}

/// Give `term` the callbacks, all reaching `hooks` (which must outlive it:
/// the Vt owns both and frees the terminal first).
pub(crate) fn install(term: ffi::GhosttyTerminal, hooks: &Hooks) -> ffi::GhosttyResult {
    let user = hooks as *const Hooks as *const c_void;
    let write: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void, *const u8, usize) =
        write_pty;
    let noted: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void) = title_changed;
    let ring: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void) = bell;
    let pwd: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void) = pwd_changed;
    let prompt: unsafe extern "C" fn(
        ffi::GhosttyTerminal,
        *mut c_void,
        *const ffi::GhosttyTerminalSemanticPrompt,
    ) = semantic_prompt;
    let options = [
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_USERDATA,
            user,
        ),
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_WRITE_PTY,
            write as *const c_void,
        ),
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
            noted as *const c_void,
        ),
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_BELL,
            ring as *const c_void,
        ),
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_PWD_CHANGED,
            pwd as *const c_void,
        ),
        (
            ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_SEMANTIC_PROMPT,
            prompt as *const c_void,
        ),
    ];
    for (option, value) in options {
        // SAFETY: a live terminal; each value is the userdata pointer or a
        // callback of the type its option documents.
        let result = unsafe { ffi::ghostty_terminal_set(term, option, value) };
        if result != ffi::GhosttyResult_GHOSTTY_SUCCESS {
            return result;
        }
    }
    ffi::GhosttyResult_GHOSTTY_SUCCESS
}

unsafe extern "C" fn write_pty(
    _t: ffi::GhosttyTerminal,
    user: *mut c_void,
    data: *const u8,
    len: usize,
) {
    if user.is_null() || data.is_null() {
        return;
    }
    // SAFETY: `user` is the boxed Hooks the terminal was given, alive as long as the Vt; `data` holds `len` bytes.
    let (hooks, bytes) = unsafe {
        (
            &*(user as *const Hooks),
            std::slice::from_raw_parts(data, len),
        )
    };
    pty::write_all(hooks.fd, bytes);
}

unsafe extern "C" fn title_changed(_t: ffi::GhosttyTerminal, user: *mut c_void) {
    // SAFETY: as in write_pty.
    if let Some(hooks) = unsafe { (user as *const Hooks).as_ref() } {
        hooks.title_changed.set(true);
    }
}

unsafe extern "C" fn bell(_t: ffi::GhosttyTerminal, user: *mut c_void) {
    // SAFETY: as in write_pty.
    if let Some(hooks) = unsafe { (user as *const Hooks).as_ref() } {
        hooks.bell.set(true);
    }
}

unsafe extern "C" fn pwd_changed(_t: ffi::GhosttyTerminal, user: *mut c_void) {
    // SAFETY: as in write_pty.
    if let Some(hooks) = unsafe { (user as *const Hooks).as_ref() } {
        hooks.pwd_changed.set(true);
    }
}

/// A libghostty-vt string as text ("" for none).
///
/// # Safety
/// `text` points at `len` readable bytes, or is null.
unsafe fn text_of(text: &ffi::GhosttyString) -> String {
    if text.ptr.is_null() || text.len == 0 {
        return String::new();
    }
    // SAFETY: per the caller.
    String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(text.ptr, text.len) }).into_owned()
}

unsafe extern "C" fn semantic_prompt(
    _t: ffi::GhosttyTerminal,
    user: *mut c_void,
    event: *const ffi::GhosttyTerminalSemanticPrompt,
) {
    // SAFETY: as in write_pty; `event` and its strings are valid during the call.
    let (Some(hooks), Some(event)) = (unsafe { (user as *const Hooks).as_ref() }, unsafe {
        event.as_ref()
    }) else {
        return;
    };
    let step = match event.kind {
        ffi::GhosttySemanticPromptKind_GHOSTTY_SEMANTIC_PROMPT_PROMPT_START
            if event.prompt_kind
                == ffi::GhosttySemanticPromptPromptKind_GHOSTTY_SEMANTIC_PROMPT_PROMPT_PRIMARY =>
        {
            Step::Prompt
        }
        ffi::GhosttySemanticPromptKind_GHOSTTY_SEMANTIC_PROMPT_INPUT_START => Step::Input,
        ffi::GhosttySemanticPromptKind_GHOSTTY_SEMANTIC_PROMPT_OUTPUT_START => {
            // SAFETY: the command string is valid during the call.
            Step::Output(unsafe { text_of(&event.command) })
        }
        ffi::GhosttySemanticPromptKind_GHOSTTY_SEMANTIC_PROMPT_COMMAND_END => {
            Step::End(event.has_exit_code.then_some(event.exit_code))
        }
        _ => return,
    };
    hooks.steps.borrow_mut().push(step);
}
