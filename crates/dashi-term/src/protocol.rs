//! The lines dashi-term and the Terminal app exchange: JSON, one object per
//! line. The app's side is packages/shell/apps/terminal/engine.ts; the two
//! change together.

mod output;
#[cfg(test)]
mod tests;

use serde::Deserialize;

pub(crate) use output::{Cursor, Frame, Line, Mark, Output, Span};

/// From the app (stdin).
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub(crate) enum Input {
    /// A key, as Metal reports it (`onKeyDown`).
    Key {
        key: String,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        ctrl: bool,
        #[serde(default)]
        alt: bool,
        #[serde(default)]
        shift: bool,
        #[serde(default)]
        meta: bool,
        #[serde(default)]
        repeat: bool,
    },
    /// Text to paste (bracketed when the program asked for it).
    Paste {
        text: String,
    },
    /// The grid the window fits, and one cell's size in pixels.
    Resize {
        cols: u16,
        rows: u16,
        cw: u16,
        ch: u16,
    },
    /// Scroll the view by lines (positive is toward older output).
    Scroll {
        lines: f64,
    },
    /// The pointer on the grid, in cells: press (with the click count), drag, release.
    Select {
        phase: Phase,
        x: u16,
        y: u16,
        #[serde(default = "one")]
        clicks: u8,
    },
    SelectAll,
    /// Reply with the selected text (`copy`).
    Copy,
    /// The terminal's own colors (`#rrggbb`): its ink, its ground, and the 16
    /// ANSI colors programs name. Programs can still change them (OSC 4, 10, 11).
    Colors {
        fg: String,
        bg: String,
        palette: Vec<String>,
    },
    /// Reply with what runs in the foreground instead of the shell (`running`).
    Running,
    /// Bring the prompt `prompts` before (negative) or after (positive) the
    /// view's top into view; needs the shell's prompt marks (OSC 133).
    Jump {
        prompts: i32,
    },
    /// Select the output of the command whose prompt is on viewport row `y`.
    SelectOutput {
        y: u16,
    },
    /// Clear the screen and the scrollback, and have the shell draw its prompt again.
    Clear,
}

fn one() -> u8 {
    1
}

#[derive(Debug, Deserialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Phase {
    Down,
    Move,
    Up,
}

/// `#rrggbb`, as the app writes colors.
pub(crate) fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// `#rrggbb` as its three channels; None for anything else.
pub(crate) fn parse_hex(text: &str) -> Option<(u8, u8, u8)> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}
