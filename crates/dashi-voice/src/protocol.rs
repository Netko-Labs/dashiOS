//! The socket's protocol (docs/voice.md): one JSON message per line.
//! A request is `{"id", "method", "params"}` and gets exactly one reply,
//! `{"id", "result"}` or `{"id", "error"}`; an event is `{"event", …}`, sent
//! only after `subscribe`. Params are read strictly: a field a method does
//! not name is refused.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

mod event;

pub(crate) use event::{Ended, Event, State, WordTime};

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

/// A stretch of what `speak` says, when the asker knows each one's language.
#[derive(Debug, Default, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Stretch {
    pub(crate) text: String,
    /// The language of all of it; none lets the service tell, a sentence at a time.
    #[serde(default)]
    pub(crate) language: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Speak {
    /// What to say; or `parts`.
    #[serde(default)]
    pub(crate) text: String,
    /// What to say, in stretches that each name their language.
    #[serde(default)]
    pub(crate) parts: Option<Vec<Stretch>>,
    /// A voice's id; none is the language's first voice, or Dashi's own.
    #[serde(default)]
    pub(crate) voice: Option<String>,
    /// The language of all of `text`; none lets the service tell, a sentence at a time.
    #[serde(default)]
    pub(crate) language: Option<String>,
    /// The voice for each other language that may be spoken ("es-CO": "ef_dora").
    #[serde(default)]
    pub(crate) voices: Option<BTreeMap<String, String>>,
    /// The conversation's language: a first sentence that gives no evidence is in it.
    #[serde(default)]
    pub(crate) hint: Option<String>,
    /// False says everything in `voice`, whatever its language.
    #[serde(default)]
    pub(crate) by_language: Option<bool>,
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
        // `text` or `parts`: one of them says what to say.
        "speak"
            if given.as_ref().is_none_or(|given| {
                given.get("text").is_none() && given.get("parts").is_none()
            }) =>
        {
            Err("speak: missing field `text`".into())
        }
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

#[cfg(test)]
#[path = "protocol_tests.rs"]
mod tests;
