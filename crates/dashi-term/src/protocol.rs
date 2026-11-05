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
    /// The terminal's own colors (`#rrggbb`): its ink, its ground, and the 16
    /// ANSI colors programs name. Programs can still change them (OSC 4, 10, 11).
    Colors {
        fg: String,
        bg: String,
        palette: Vec<String>,
    },
    /// Reply with what runs in the foreground instead of the shell (`running`).
    Running,
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
    /// In reply to `running`: the foreground program's name when it isn't the
    /// shell (empty when it has none), else null.
    Running {
        program: Option<String>,
    },
}

#[derive(Debug, Serialize, Default)]
pub(crate) struct Frame {
    pub cols: u16,
    pub rows: u16,
    pub full: bool,
    /// The terminal's ink and ground as they are now (a program may have set
    /// them); absent until the app or a program sets them. Named apart from
    /// the `fg`/`bg` that dashi-term 0.2 always sent, so an app never takes
    /// those for colors to paint with.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground: Option<String>,
    pub cursor: Cursor,
    pub lines: Vec<Line>,
    /// Scrollback: total rows, the view's first row, and how many it shows.
    pub scroll: [u64; 3],
}

#[derive(Debug, Serialize, Default, Clone, PartialEq)]
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

/// `#rrggbb` as its three channels; None for anything else.
pub(crate) fn parse_hex(text: &str) -> Option<(u8, u8, u8)> {
    let digits = text.strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
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
    fn colors_and_running_parse() {
        let input: Input = serde_json::from_str(
            r##"{"t":"colors","fg":"#1d1d1f","bg":"#fbfaf7","palette":["#000000"]}"##,
        )
        .expect("colors");
        assert_eq!(
            input,
            Input::Colors {
                fg: "#1d1d1f".into(),
                bg: "#fbfaf7".into(),
                palette: vec!["#000000".into()]
            }
        );
        assert_eq!(
            serde_json::from_str::<Input>(r#"{"t":"running"}"#).expect("running"),
            Input::Running
        );
        assert_eq!(
            serde_json::to_string(&Output::Running { program: None }).expect("json"),
            r#"{"t":"running","program":null}"#
        );
    }

    #[test]
    fn hex_colors_read_back() {
        assert_eq!(parse_hex("#1d1D1f"), Some((0x1d, 0x1d, 0x1f)));
        assert_eq!(parse_hex(&hex(1, 2, 3)), Some((1, 2, 3)));
        for bad in ["1d1d1f", "#1d1d1", "#1d1d1fff", "#gggggg", ""] {
            assert_eq!(parse_hex(bad), None, "{bad}");
        }
    }

    #[test]
    fn frames_leave_unset_colors_out() {
        let frame = Frame::default();
        let json = serde_json::to_string(&Output::Frame(frame)).expect("json");
        assert!(
            !json.contains("\"ink\"") && !json.contains("\"ground\""),
            "{json}"
        );
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
