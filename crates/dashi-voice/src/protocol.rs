//! The shell's requests and the service's replies and events: one JSON object
//! per line on `$XDG_RUNTIME_DIR/dashi-voice.sock` (docs/architecture.md,
//! "Voice"). Every request carries an `id` and gets exactly one reply;
//! events are unsolicited. Every frame is parsed and checked on receipt.

use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "method", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum Command {
    /// What is loaded, and what is going on.
    Status,
    /// (Re)load the models from the models folder (after a download).
    Load,
    /// Open the microphone: `hold` until `listen-end`, or `turn`, ended by silence.
    Listen {
        mode: ListenMode,
        #[serde(rename = "waitMs", default)]
        wait_ms: Option<u32>,
        #[serde(rename = "silenceMs", default)]
        silence_ms: Option<u32>,
    },
    /// The key was let go: what was said, as text.
    ListenEnd,
    /// Close the microphone and drop what it heard.
    ListenCancel,
    /// Say `text` in `voice`; `utterance` names it in the events.
    Speak {
        utterance: String,
        text: String,
        voice: String,
        #[serde(default)]
        lang: Option<String>,
        #[serde(default)]
        speed: Option<f32>,
    },
    /// Stop talking now.
    StopSpeaking,
    /// Settings the shell owns.
    Config {
        #[serde(rename = "interruptBySpeaking")]
        interrupt_by_speaking: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ListenMode {
    Hold,
    Turn,
}

impl ListenMode {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Hold => "hold",
            Self::Turn => "turn",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Request {
    pub id: u64,
    pub command: Command,
}

/// A line from the shell. An unparsable line is an error reply (with its id
/// when one can be read), never a panic.
pub(crate) fn parse_request(line: &str) -> Result<Request, (Option<u64>, String)> {
    let value: Value =
        serde_json::from_str(line).map_err(|error| (None, format!("not JSON: {error}")))?;
    let Value::Object(mut object) = value else {
        return Err((None, "a request is a JSON object".into()));
    };
    let id = object
        .remove("id")
        .and_then(|id| id.as_u64())
        .ok_or((None, "a request needs a numeric id".to_string()))?;
    let command: Command = serde_json::from_value(Value::Object(object))
        .map_err(|error| (Some(id), error.to_string()))?;
    if let Command::Speak { text, speed, .. } = &command {
        if text.len() > 8_000 {
            return Err((Some(id), "text is longer than 8000 bytes".into()));
        }
        if speed.is_some_and(|speed| !(0.5..=2.0).contains(&speed)) {
            return Err((Some(id), "speed is between 0.5 and 2".into()));
        }
    }
    Ok(Request { id, command })
}

pub(crate) fn reply_ok(id: u64, result: Value) -> Value {
    json!({ "id": id, "ok": true, "result": result })
}

pub(crate) fn reply_error(id: Option<u64>, error: &str) -> Value {
    json!({ "id": id, "ok": false, "error": error })
}

pub(crate) fn event(name: &str, fields: Value) -> Value {
    let mut value = json!({ "event": name });
    if let (Value::Object(target), Value::Object(source)) = (&mut value, fields) {
        target.extend(source);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_request() {
        let request =
            parse_request(r#"{"id":3,"method":"listen","mode":"turn","waitMs":8000}"#).unwrap();
        assert_eq!(
            request,
            Request {
                id: 3,
                command: Command::Listen {
                    mode: ListenMode::Turn,
                    wait_ms: Some(8000),
                    silence_ms: None
                }
            }
        );
        let speak = parse_request(
            r#"{"id":4,"method":"speak","utterance":"u1","text":"Hi","voice":"af_heart"}"#,
        )
        .unwrap();
        assert!(matches!(speak.command, Command::Speak { ref voice, .. } if voice == "af_heart"));
        assert_eq!(
            parse_request(r#"{"id":5,"method":"listen-end"}"#)
                .unwrap()
                .command,
            Command::ListenEnd
        );
        assert_eq!(
            parse_request(r#"{"id":6,"method":"config","interruptBySpeaking":false}"#)
                .unwrap()
                .command,
            Command::Config {
                interrupt_by_speaking: false
            }
        );
    }

    #[test]
    fn bad_lines_are_errors_with_their_id() {
        assert_eq!(parse_request("nope").unwrap_err().0, None);
        assert_eq!(parse_request(r#"{"method":"status"}"#).unwrap_err().0, None);
        assert_eq!(
            parse_request(r#"{"id":7,"method":"dance"}"#).unwrap_err().0,
            Some(7)
        );
        assert_eq!(
            parse_request(r#"{"id":8,"method":"listen","mode":"hold","extra":1}"#)
                .unwrap_err()
                .0,
            Some(8)
        );
        let fast = r#"{"id":9,"method":"speak","utterance":"u","text":"a","voice":"v","speed":9}"#;
        assert_eq!(parse_request(fast).unwrap_err().0, Some(9));
    }

    #[test]
    fn events_carry_their_fields() {
        let value = event("heard", json!({ "text": "hola" }));
        assert_eq!(value, json!({ "event": "heard", "text": "hola" }));
    }
}
