//! dashi-term: the engine behind Dashi's Terminal. It runs the person's
//! shell on a PTY, keeps the terminal's state in libghostty-vt (Ghostty's
//! terminal core: escape sequences, scrollback, reflow, key encoding), and
//! streams what to draw to the Terminal app as JSON lines on stdout. The app
//! (packages/shell/apps/terminal, Bun + Metal) draws it and sends input back
//! on stdin. Rust keeps the terminal; TypeScript draws it.
//!
//! Usage: `dashi-term [--cols N] [--rows N] [--cwd DIR] [--integration DIR]`
//! (`--integration`: the shell integration's scripts, integration.rs).

#[allow(
    non_upper_case_globals,
    non_camel_case_types,
    non_snake_case,
    dead_code,
    unnecessary_transmutes,
    clippy::all,
    clippy::pedantic
)]
mod ffi_generated;
mod frame;
mod hooks;
mod integration;
mod keys;
mod marks;
mod protocol;
mod pty;
mod selection;
mod vt;

use std::io::{BufRead, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use protocol::{Input, Output};

/// What the main loop hears.
pub(crate) enum Message {
    Output(Vec<u8>),
    Closed,
    Input(Input),
    /// The app went away (stdin closed).
    Gone,
}

/// Frames are coalesced to at most one per this long, so a flood of output
/// (a `cat` of a big file) costs one frame, not thousands.
const FRAME_EVERY: Duration = Duration::from_millis(8);

struct Options {
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    integration: Option<String>,
}

fn options() -> Options {
    let mut options = Options {
        cols: 80,
        rows: 24,
        cwd: None,
        integration: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cols" => options.cols = args.next().and_then(|v| v.parse().ok()).unwrap_or(80),
            "--rows" => options.rows = args.next().and_then(|v| v.parse().ok()).unwrap_or(24),
            "--cwd" => options.cwd = args.next(),
            "--integration" => options.integration = args.next(),
            _ => {}
        }
    }
    options
}

fn send(out: &mut impl Write, message: &Output) {
    if let Ok(line) = serde_json::to_string(message) {
        let _ = writeln!(out, "{line}");
        let _ = out.flush();
    }
}

fn main() {
    let options = options();
    // The PTY first, while this is the only thread (fork).
    let pty = match pty::Pty::spawn(
        options.cols,
        options.rows,
        options.cwd.as_deref(),
        options.integration.as_deref(),
    ) {
        Ok(pty) => pty,
        Err(error) => {
            eprintln!("dashi-term: could not start the shell: {error}");
            std::process::exit(1);
        }
    };
    let mut vt = match vt::Vt::new(options.cols, options.rows, pty.fd()) {
        Ok(vt) => vt,
        Err(error) => {
            eprintln!("dashi-term: {error}");
            std::process::exit(1);
        }
    };
    let (tx, rx) = mpsc::channel();
    if let Err(error) = pty.read_into(tx.clone()) {
        eprintln!("dashi-term: {error}");
        std::process::exit(1);
    }
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            match serde_json::from_str::<Input>(&line) {
                Ok(input) => {
                    if tx.send(Message::Input(input)).is_err() {
                        return;
                    }
                }
                Err(error) => eprintln!("dashi-term: ignoring a bad line: {error}"),
            }
        }
        let _ = tx.send(Message::Gone);
    });

    let mut out = std::io::stdout().lock();
    let mut last_frame = Instant::now() - FRAME_EVERY;
    let mut pending = true;
    let mut force = true;
    loop {
        let wait = if pending {
            FRAME_EVERY.saturating_sub(last_frame.elapsed())
        } else {
            Duration::from_secs(3600)
        };
        match rx.recv_timeout(wait) {
            Ok(Message::Output(bytes)) => {
                vt.feed(&bytes);
                // The folder and the command's steps go at once, ahead of the frame that shows them.
                for message in vt.take_outbox() {
                    send(&mut out, &message);
                }
                pending = true;
            }
            Ok(Message::Input(input)) => {
                pending = true;
                match input {
                    Input::Key {
                        key,
                        text,
                        ctrl,
                        alt,
                        shift,
                        meta,
                        repeat,
                    } => vt.key(&key, text.as_deref(), ctrl, alt, shift, meta, repeat),
                    Input::Paste { text } => vt.paste(&text),
                    Input::Resize { cols, rows, cw, ch } => {
                        vt.resize(cols, rows, cw, ch);
                        pty.resize(cols, rows, cw, ch);
                        force = true;
                    }
                    Input::Scroll { lines } => vt.scroll(lines),
                    Input::Select {
                        phase,
                        x,
                        y,
                        clicks,
                    } => vt.select(phase, x, y, clicks),
                    Input::SelectAll => vt.select_all(),
                    Input::Copy => send(&mut out, &Output::Copied { text: vt.copy() }),
                    Input::Colors { fg, bg, palette } => {
                        vt.set_colors(&fg, &bg, &palette);
                        force = true;
                    }
                    Input::Running => send(
                        &mut out,
                        &Output::Running {
                            program: pty.foreground(),
                        },
                    ),
                    Input::Jump { prompts } => vt.jump(prompts),
                    Input::SelectOutput { y } => vt.select_output(y),
                    Input::Clear => {
                        vt.clear();
                        force = true;
                    }
                }
            }
            Ok(Message::Closed) => {
                if let Some(frame) = vt.frame(false) {
                    send(&mut out, &Output::Frame(frame));
                }
                send(
                    &mut out,
                    &Output::Exit {
                        code: pty::exit_code(pty.child),
                    },
                );
                return;
            }
            Ok(Message::Gone) => {
                // SAFETY: hanging up our own child's session, as closing a terminal window does.
                unsafe { libc::kill(pty.child, libc::SIGHUP) };
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if pending && last_frame.elapsed() >= FRAME_EVERY {
            if let Some(title) = vt.take_title() {
                send(&mut out, &Output::Title { title });
            }
            if vt.take_bell() {
                send(&mut out, &Output::Bell);
            }
            if let Some(frame) = vt.frame(force) {
                send(&mut out, &Output::Frame(frame));
            }
            last_frame = Instant::now();
            pending = false;
            force = false;
        }
    }
}
