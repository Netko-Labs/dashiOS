//! From the speech a listen kept to words: all of it when the listen ends, and the words so far while it goes on.

use std::sync::atomic::Ordering;
use std::sync::mpsc::Receiver;

use super::Service;
use super::capture::Ended;
use super::listen::{RUNNING, Run};
use crate::audio::LISTEN_RATE;
use crate::engine::gate::Gate;
use crate::protocol::Event;
use crate::tongue::{self, Tongue};

#[derive(Clone)]
pub(super) struct Heard {
    pub(super) text: String,
    pub(super) speech_ms: u64,
    /// The language of the words, when they tell it.
    pub(super) language: Option<String>,
    /// Why the listen ended ("key-up(224)").
    pub(super) ended: String,
    /// The model that heard it.
    pub(super) model: &'static str,
}

/// Parakeet picks the language itself and does not say which, so the words
/// tell: one of the languages Dashi speaks, or none when they give too little.
fn language_of(text: &str) -> Option<String> {
    tongue::evidence(text, &Tongue::ALL).map(|tongue| tongue.code().to_owned())
}

impl Service {
    /// The speech as words.
    pub(super) fn words(
        &self,
        gate: &Gate,
        language: Option<&str>,
        model: Option<&str>,
        ended: Ended,
    ) -> Result<Heard, String> {
        let speech_ms = gate.speech().len() as u64 * 1000 / u64::from(LISTEN_RATE);
        let (ended, model_name) = (
            ended.to_string(),
            self.engines.recognizer_name(language, model),
        );
        if !gate.heard() {
            return Ok(Heard {
                text: String::new(),
                speech_ms: 0,
                language: None,
                ended,
                model: model_name,
            });
        }
        let recognizer = self.engines.recognizer_for(language, model)?;
        let mut recognizer = recognizer.lock().map_err(|_| "Voice is not well.")?;
        let text = crate::engine::transcribe(&mut *recognizer, gate.speech(), language)?;
        let language = language_of(&text);
        Ok(Heard {
            text,
            speech_ms,
            language,
            ended,
            model: model_name,
        })
    }

    /// Words as they come: the speech so far, each time the listen hands some over.
    pub(super) fn partials(
        &self,
        run: &Run,
        speech: &Receiver<Vec<f32>>,
        language: Option<&str>,
        model: Option<&str>,
    ) {
        let mut last = String::new();
        for speech in speech {
            let Ok(recognizer) = self.engines.recognizer_for(language, model) else {
                return;
            };
            let Ok(mut recognizer) = recognizer.lock() else {
                return;
            };
            let Ok(text) = crate::engine::transcribe(&mut *recognizer, &speech, language) else {
                continue;
            };
            if run.mode.load(Ordering::SeqCst) == RUNNING && !text.is_empty() && text != last {
                self.hub.emit(&Event::Partial { text: text.clone() });
                last = text;
            }
        }
    }
}
