//! The lines parse and serialize as the app expects.

use super::{Frame, Input, Mark, Output, Phase, Span, hex, parse_hex};

#[test]
fn keys_parse_with_defaults() {
    let input: Input = serde_json::from_str(r#"{"t":"key","key":"c","ctrl":true}"#).expect("a key");
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
        r#"{"s":"hi","x":0,"w":0,"b":true}"#
    );
}

#[test]
fn integration_inputs_and_outputs() {
    assert_eq!(
        serde_json::from_str::<Input>(r#"{"t":"jump","prompts":-1}"#).expect("jump"),
        Input::Jump { prompts: -1 }
    );
    assert_eq!(
        serde_json::from_str::<Input>(r#"{"t":"select-output","y":3}"#).expect("output"),
        Input::SelectOutput { y: 3 }
    );
    assert_eq!(
        serde_json::from_str::<Input>(r#"{"t":"clear"}"#).expect("clear"),
        Input::Clear
    );
    assert_eq!(
        serde_json::to_string(&Output::Cwd {
            path: "/home/alexk".into(),
            host: String::new()
        })
        .expect("json"),
        r#"{"t":"cwd","path":"/home/alexk","host":""}"#
    );
    assert_eq!(
        serde_json::to_string(&Output::Done { code: Some(1) }).expect("json"),
        r#"{"t":"done","code":1}"#
    );
    let frame = Frame {
        marks: vec![
            Mark { y: 2, failed: true },
            Mark {
                y: 5,
                failed: false,
            },
        ],
        ..Frame::default()
    };
    let json = serde_json::to_string(&frame).expect("json");
    assert!(
        json.contains(r#""marks":[{"y":2,"failed":true},{"y":5}]"#),
        "{json}"
    );
}
