use super::*;

fn request(line: &str) -> Result<Request, String> {
    parse(line.as_bytes()).1
}

#[test]
fn every_method_parses_with_and_without_params() {
    for method in METHODS {
        let bare = match method {
            "speak" => format!(r#"{{"id":1,"method":"{method}","params":{{"text":"hi"}}}}"#),
            _ => format!(r#"{{"id":1,"method":"{method}"}}"#),
        };
        assert!(request(&bare).is_ok(), "{method}: {:?}", request(&bare));
        if method != "speak" {
            let empty = format!(r#"{{"id":1,"method":"{method}","params":{{}}}}"#);
            assert!(request(&empty).is_ok(), "{method}");
        }
    }
    assert_eq!(
        request(r#"{"id":1,"method":"status"}"#),
        Ok(Request::Status)
    );
}

#[test]
fn params_are_read_strictly() {
    assert_eq!(
        request(
            r#"{"id":2,"method":"listen","params":{"language":"es","until":"silence","quiet_ms":900}}"#
        ),
        Ok(Request::Listen(Listen {
            language: Some("es".into()),
            until: Until::Silence,
            quiet_ms: Some(900),
            partials: None,
        }))
    );
    let unknown = request(r#"{"id":2,"method":"listen","params":{"lang":"es"}}"#).unwrap_err();
    assert!(unknown.contains("unknown field `lang`"), "{unknown}");
    let extra = request(r#"{"id":2,"method":"status","params":{"x":1}}"#).unwrap_err();
    assert!(extra.starts_with("status: unknown field"), "{extra}");
    assert!(
        request(r#"{"id":2,"method":"speak"}"#)
            .unwrap_err()
            .contains("missing field `text`")
    );
    assert!(request(r#"{"id":2,"method":"listen","params":{"until":"later"}}"#).is_err());
}

#[test]
fn what_is_not_a_request_still_gets_its_id_back() {
    let (id, result) = parse(br#"{"id":7,"method":"dance"}"#);
    assert_eq!((id, result), (Some(7), Err("unknown method dance".into())));
    let (id, result) = parse(br#"{"id":8}"#);
    assert_eq!(id, Some(8));
    assert!(result.unwrap_err().starts_with("not a request"));
    assert_eq!(parse(b"hello").0, None);
    assert_eq!(reply(Some(7), Err("no".into())), r#"{"error":"no","id":7}"#);
    assert_eq!(
        reply(Some(7), Ok(json!({"a":1}))),
        r#"{"id":7,"result":{"a":1}}"#
    );
}

#[test]
fn events_are_one_line_named_by_event() {
    assert_eq!(
        Event::State {
            state: State::Listening
        }
        .line(),
        r#"{"event":"state","state":"listening"}"#
    );
    assert_eq!(Event::Models {}.line(), r#"{"event":"models"}"#);
    let spoken = Event::Spoken {
        id: 3,
        reason: Ended::Stopped,
        error: None,
    }
    .line();
    assert_eq!(spoken, r#"{"event":"spoken","id":3,"reason":"stopped"}"#);
    let sentence = Event::Sentence {
        id: 3,
        index: 0,
        text: "Hi there.".into(),
        ms: 900,
        words: vec![WordTime {
            text: "Hi".into(),
            start: 100,
            end: 300,
        }],
    }
    .line();
    assert_eq!(
        sentence,
        r#"{"event":"sentence","id":3,"index":0,"text":"Hi there.","ms":900,"words":[{"text":"Hi","start":100,"end":300}]}"#
    );
}

/// docs/voice.md is the contract: it names every method and every event the code has.
#[test]
fn the_doc_names_every_method_and_event() {
    let doc = include_str!("../../../docs/voice.md");
    for method in METHODS {
        assert!(
            doc.contains(&format!("| `{method}` |")),
            "docs/voice.md lacks the method {method}"
        );
    }
    let events = [
        Event::State { state: State::Idle },
        Event::Level { level: 0.0 },
        Event::Partial {
            text: String::new(),
        },
        Event::Heard {
            text: String::new(),
            speech_ms: 0,
        },
        Event::Sentence {
            id: 0,
            index: 0,
            text: String::new(),
            ms: 0,
            words: Vec::new(),
        },
        Event::Spoken {
            id: 0,
            reason: Ended::Done,
            error: None,
        },
        Event::Fetch {
            set: None,
            file: None,
            received: 0,
            bytes: 0,
            done: false,
            error: None,
        },
        Event::Models {},
        Event::Error {
            message: String::new(),
        },
    ];
    for event in events {
        let line: Value = serde_json::from_str(&event.line()).unwrap();
        let name = line["event"].as_str().unwrap();
        assert!(
            doc.contains(&format!("| `{name}` |")),
            "docs/voice.md lacks the event {name}"
        );
    }
}
