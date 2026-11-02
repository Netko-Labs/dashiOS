//! The lines dashi-term and the Terminal app exchange: JSON, one object per
//! line. The app's side is packages/shell/apps/terminal/engine.ts; the two
//! change together.

use serde::{Deserialize, Serialize};

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

/// To the app (stdout).
#[derive(Debug, Serialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub(crate) enum Output {
    /// What changed on screen: the rows in `lines` (all of them when `full`).
    Frame(Frame),
    Title {
        title: String,
    },
    Bell,
    /// The selected text, in reply to `copy` (empty when nothing is selected).
    Copied {
        text: String,
    },
    /// The shell exited.
    Exit {
        code: i32,
    },
}

#[derive(Debug, Serialize, Default)]
pub(crate) struct Frame {
    pub cols: u16,
    pub rows: u16,
    pub full: bool,
    pub fg: String,
    pub bg: String,
    pub cursor: Cursor,
    pub lines: Vec<Line>,
    /// Scrollback: total rows, the view's first row, and how many it shows.
    pub scroll: [u64; 3],
}

#[derive(Debug, Serialize, Default)]
pub(crate) struct Cursor {
    pub x: u16,
    pub y: u16,
    pub visible: bool,
    /// "block", "bar", "underline", or "hollow".
    pub style: &'static str,
}

#[derive(Debug, Serialize, Default)]
pub(crate) struct Line {
    pub y: u16,
    pub spans: Vec<Span>,
}

/// A run of cells drawn alike. Colors are `#rrggbb`; absent means the terminal's default.
#[derive(Debug, Serialize, Default, Clone, PartialEq)]
pub(crate) struct Span {
    pub s: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub b: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub i: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub u: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub st: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub dim: bool,
    /// Selected.
    #[serde(skip_serializing_if = "is_false")]
    pub sel: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub(crate) fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_parse_with_defaults() {
        let input: Input =
            serde_json::from_str(r#"{"t":"key","key":"c","ctrl":true}"#).expect("a key");
        assert_eq!(
            input,
            Input::Key {
                key: "c".into(),
                text: None,
                ctrl: true,
                alt: false,
                shift: false,
                meta: false,
                repeat: false
            }
        );
    }

    #[test]
    fn selection_parses() {
        let input: Input =
            serde_json::from_str(r#"{"t":"select","phase":"down","x":3,"y":4,"clicks":2}"#)
                .expect("a press");
        assert_eq!(
            input,
            Input::Select {
                phase: Phase::Down,
                x: 3,
                y: 4,
                clicks: 2
            }
        );
        assert!(serde_json::from_str::<Input>(r#"{"t":"select-all"}"#).is_ok());
    }

    #[test]
    fn spans_leave_defaults_out() {
        let span = Span {
            s: "hi".into(),
            b: true,
            ..Span::default()
        };
        assert_eq!(
            serde_json::to_string(&span).expect("json"),
            r#"{"s":"hi","b":true}"#
        );
    }
}
