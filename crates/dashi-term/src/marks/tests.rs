//! Marks, the shell's news and prompt jumps, against a real terminal.

use super::pieces;
use crate::protocol::Mark;
use crate::vt::Vt;

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
