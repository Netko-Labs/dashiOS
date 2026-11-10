//! What dashi-term sends the app: frames and the shell integration's news.

use serde::Serialize;

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
    /// The shell's folder changed (OSC 7): the path, decoded, and the host
    /// the shell named (empty when it named none). The host may be another
    /// machine's (a shell over `ssh` with its own integration).
    Cwd {
        path: String,
        host: String,
    },
    /// The shell drew a new prompt (OSC 133 A): nothing runs in front of it.
    Prompt,
    /// A command started (OSC 133 C), with its command line when the shell sent it.
    Command {
        command: String,
    },
    /// The command ended (OSC 133 D), with its exit status when the shell sent it.
    Done {
        code: Option<i32>,
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
    /// Something is selected (in view or not): Copy has something to copy.
    #[serde(skip_serializing_if = "is_false")]
    pub selected: bool,
    /// The commands whose prompts are in view (the shell's OSC 133 marks),
    /// in every frame: the app draws them in the margin.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
}

/// A command's prompt row in view, and whether the command failed.
#[derive(Debug, Serialize, Clone, PartialEq)]
pub(crate) struct Mark {
    pub y: u16,
    #[serde(skip_serializing_if = "is_false")]
    pub failed: bool,
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

/// A run of cells drawn alike, from column `x`, `w` cells wide: the app puts
/// it on the grid there, whatever its glyphs' own widths. Colors are
/// `#rrggbb`; absent means the terminal's default.
#[derive(Debug, Serialize, Default, Clone, PartialEq)]
pub(crate) struct Span {
    pub s: String,
    pub x: u16,
    pub w: u16,
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
