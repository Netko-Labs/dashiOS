//! What the service tells: its state, and the events a subscriber gets.

use serde::Serialize;

use crate::engine::Word;

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
    /// The detector heard the person begin to speak: once a listen, so a listen that ends by itself is not given up on.
    Speech {},
    /// The words so far; the next `partial` or `heard` replaces them.
    Partial {
        text: String,
    },
    /// A listen ended: the words (none when nothing was said), and how long the speech was.
    Heard {
        text: String,
        speech_ms: u64,
        /// The language of the words, when they tell it.
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
        /// Why the listen ended: "key-up(224)", "silence(1800)", "max", "closed".
        #[serde(skip_serializing_if = "Option::is_none")]
        ended: Option<String>,
        /// The model that heard it ("parakeet-v3", "whisper-turbo").
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    /// A sentence begins to sound now: its words and when each is said, in ms from now.
    Sentence {
        id: u64,
        index: usize,
        text: String,
        ms: u64,
        words: Vec<WordTime>,
        /// The voice that says it, and the language it is read in.
        voice: String,
        language: String,
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
