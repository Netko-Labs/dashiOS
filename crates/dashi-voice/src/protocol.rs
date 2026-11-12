//! The socket's protocol (docs/voice.md): one JSON message per line.
//! A request is `{"id", "method", "params"}` and gets exactly one reply,
//! `{"id", "result"}` or `{"id", "error"}`; an event is `{"event", …}`, sent
//! only after `subscribe`. Params are read strictly: a field a method does
//! not name is refused.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::engine::Word;

/// The longest request line: a page of text to say fits; a runaway client doesn't.
pub(crate) const MAX_LINE: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Frame {
    id: u64,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Sets {
    /// The sets by id; none means the basic ones for `fetch`, all for `remove`.
    #[serde(default)]
    pub(crate) sets: Option<Vec<String>>,
}

/// When a listen ends.
#[derive(Debug, Default, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Until {
    /// When `listen.stop` says so: the key is held.
    #[default]
    Stop,
    /// By itself, once the person has spoken and gone quiet.
    Silence,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Listen {
    /// The language spoken ("en", "pt-BR"); none lets the model tell.
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default)]
    pub(crate) until: Until,
    /// For `until: "silence"`: how long a quiet ends the listen, 300 to 10000 ms.
    #[serde(default)]
    pub(crate) quiet_ms: Option<u64>,
    /// Words as they come (`partial` events); on unless false.
    #[serde(default)]
    pub(crate) partials: Option<bool>,
}

/// `listen.quiet`: the listen under way ends by itself from now on.
#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Quiet {
    /// How long a quiet ends the listen, 300 to 10000 ms; 1200 unless given.
    #[serde(default)]
    pub(crate) quiet_ms: Option<u64>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Speak {
    pub(crate) text: String,
    /// A voice's id; none is the language's first voice, or Dashi's own.
    #[serde(default)]
    pub(crate) voice: Option<String>,
    #[serde(default)]
    pub(crate) language: Option<String>,
    /// 0.5 to 2; 1 is the voice's own pace.
    #[serde(default)]
    pub(crate) speed: Option<f32>,
    /// Say it after what is being said, instead of in its place.
    #[serde(default)]
    pub(crate) queue: bool,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Warm {
    #[serde(default)]
    pub(crate) listen: bool,
    #[serde(default)]
    pub(crate) speak: bool,
    #[serde(default)]
    pub(crate) language: Option<String>,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Request {
    Status,
    Subscribe,
    Models,
    Fetch(Sets),
    FetchCancel,
    Remove(Sets),
    Voices,
    Warm(Warm),
    Listen(Listen),
    ListenStop,
    ListenQuiet(Quiet),
    ListenCancel,
    Speak(Speak),
    SpeakStop,
}

/// Every method: docs/voice.md names each (protocol_tests.rs holds it to that).
#[cfg(test)]
pub(crate) const METHODS: [&str; 14] = [
    "status",
    "subscribe",
    "models",
    "fetch",
    "fetch.cancel",
    "remove",
    "voices",
    "warm",
    "listen",
    "listen.stop",
    "listen.quiet",
    "listen.cancel",
    "speak",
    "speak.stop",
];

fn params<T: serde::de::DeserializeOwned>(
    method: &str,
    params: Option<Value>,
) -> Result<T, String> {
    serde_json::from_value(params.unwrap_or_else(|| json!({})))
        .map_err(|error| format!("{method}: {error}"))
}

fn none(method: &str, given: Option<Value>, request: Request) -> Result<Request, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Nothing {}
    params::<Nothing>(method, given).map(|_| request)
}

/// A line as a request: its id (when it can be read) and the request, or why not.
pub(crate) fn parse(line: &[u8]) -> (Option<u64>, Result<Request, String>) {
    let frame: Frame = match serde_json::from_slice(line) {
        Ok(frame) => frame,
        Err(error) => {
            let id = serde_json::from_slice::<Value>(line)
                .ok()
                .and_then(|value| value.get("id")?.as_u64());
            return (id, Err(format!("not a request: {error}")));
        }
    };
    let (method, given) = (frame.method.as_str(), frame.params);
    let request = match method {
        "status" => none(method, given, Request::Status),
        "subscribe" => none(method, given, Request::Subscribe),
        "models" => none(method, given, Request::Models),
        "fetch" => params(method, given).map(Request::Fetch),
        "fetch.cancel" => none(method, given, Request::FetchCancel),
        "remove" => params(method, given).map(Request::Remove),
        "voices" => none(method, given, Request::Voices),
        "warm" => params(method, given).map(Request::Warm),
        "listen" => params(method, given).map(Request::Listen),
        "listen.stop" => none(method, given, Request::ListenStop),
        "listen.quiet" => params(method, given).map(Request::ListenQuiet),
        "listen.cancel" => none(method, given, Request::ListenCancel),
        "speak" => params(method, given).map(Request::Speak),
        "speak.stop" => none(method, given, Request::SpeakStop),
        _ => Err(format!("unknown method {method}")),
    };
    (Some(frame.id), request)
}

/// The reply's line, without its newline.
pub(crate) fn reply(id: Option<u64>, result: Result<Value, String>) -> String {
    match result {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(error) => json!({ "id": id, "error": error }),
    }
    .to_string()
}

/// What Voice is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum State {
    Idle,
    /// The microphone is open.
    Listening,
    /// Working: turning speech into words, or words into speech before the first sound.
    Thinking,
    Speaking,
}

/// Why something being said ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Ended {
    Done,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(crate) struct WordTime {
    pub(crate) text: String,
    pub(crate) start: u64,
    pub(crate) end: u64,
}

impl From<&Word> for WordTime {
    fn from(word: &Word) -> Self {
        Self {
            text: word.text.clone(),
            start: word.start_ms,
            end: word.end_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "kebab-case")]
pub(crate) enum Event {
    State {
        state: State,
    },
    /// The microphone's loudness, 0 to 1, about 31 times a second while listening.
    Level {
        level: f32,
    },
    /// The words so far; the next `partial` or `heard` replaces them.
    Partial {
        text: String,
    },
    /// A listen ended: the words (none when nothing was said), and how long the speech was.
    Heard {
        text: String,
        speech_ms: u64,
    },
    /// A sentence begins to sound now: its words and when each is said, in ms from now.
    Sentence {
        id: u64,
        index: usize,
        text: String,
        ms: u64,
        words: Vec<WordTime>,
    },
    /// What `speak` gave this id has ended.
    Spoken {
        id: u64,
        reason: Ended,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// A fetch's progress over all its files; `done` ends it, with `error` if it failed.
    Fetch {
        #[serde(skip_serializing_if = "Option::is_none")]
        set: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        file: Option<String>,
        received: u64,
        bytes: u64,
        done: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Which models are here changed: ask `models` again.
    Models {},
    /// Something failed outside a request, in words for the person.
    Error {
        message: String,
    },
}

impl Event {
    pub(crate) fn line(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"event":"error","message":"an event could not be written"}"#.into()
        })
    }
}

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
