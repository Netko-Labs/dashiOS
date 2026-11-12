//! The models in memory. Each is loaded when first needed and kept, so the
//! next hold of the key answers at once; `rest` lets go of them all after a
//! while unused, and `forget` when their files are removed.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::engine::kokoro::Kokoro;
use crate::engine::parakeet::{self, Parakeet};
use crate::engine::vad::{Silero, SpeechDetector};
use crate::engine::whisper::Whisper;
use crate::engine::{Recognizer, Synthesizer};
use crate::models::manifest::{LISTEN_SET, SPEAK_SET, WHISPER_SET};
use crate::models::store::Store;

pub(crate) type Shared<T> = Arc<Mutex<T>>;

pub(crate) trait Engines: Send + Sync {
    /// Why this language can't be heard now, without loading anything; none when it can.
    fn deaf_to(&self, language: Option<&str>) -> Option<String>;
    fn detector(&self) -> Result<Box<dyn SpeechDetector>, String>;
    fn recognizer(&self, language: Option<&str>) -> Result<Shared<dyn Recognizer>, String>;
    /// Why nothing can be said in this voice now; none when it can.
    fn mute_in(&self, voice: &str) -> Option<String>;
    fn synthesizer(&self) -> Result<Shared<dyn Synthesizer>, String>;
    /// Let go of a set's models: its files are going.
    fn forget(&self, set: &str);
    /// Let go of every model, if none was used for `idle`.
    fn rest(&self, now: Duration, idle: Duration);
    /// Something used a model now.
    fn touch(&self, now: Duration);
}

/// "pt-BR" and "PT" are "pt".
pub(crate) fn primary(language: &str) -> String {
    language
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_lowercase()
}

#[derive(Default)]
struct Held {
    parakeet: Option<Shared<dyn Recognizer>>,
    whisper: Option<Shared<dyn Recognizer>>,
    kokoro: Option<Shared<dyn Synthesizer>>,
    used: Duration,
}

pub(crate) struct Loaded {
    store: Store,
    held: Mutex<Held>,
}

const NOT_HERE_LISTEN: &str =
    "Voice can't listen yet: its listening models are not on this computer.";
const NOT_HERE_SPEAK: &str = "Voice can't speak yet: its speaking models are not on this computer.";

impl Loaded {
    pub(crate) fn new(store: Store) -> Self {
        Self {
            store,
            held: Mutex::new(Held::default()),
        }
    }

    fn folder(&self, set: &str) -> PathBuf {
        self.store.set_folder(set)
    }

    /// Whether Whisper is the one to hear this language.
    fn wants_whisper(language: Option<&str>) -> bool {
        language.is_some_and(|language| !parakeet::LANGUAGES.contains(&primary(language).as_str()))
    }
}

impl Engines for Loaded {
    fn deaf_to(&self, language: Option<&str>) -> Option<String> {
        if !self.store.installed_id(LISTEN_SET) {
            return Some(NOT_HERE_LISTEN.into());
        }
        if Self::wants_whisper(language) && !self.store.installed_id(WHISPER_SET) {
            let language = language.unwrap_or_default();
            return Some(format!(
                "Voice can't hear {language} yet: that needs the More languages models, which are not on this computer."
            ));
        }
        None
    }

    fn detector(&self) -> Result<Box<dyn SpeechDetector>, String> {
        if !self.store.installed_id(LISTEN_SET) {
            return Err(NOT_HERE_LISTEN.into());
        }
        Ok(Box::new(Silero::open(
            &self.folder(LISTEN_SET).join("silero-vad.onnx"),
        )?))
    }

    fn recognizer(&self, language: Option<&str>) -> Result<Shared<dyn Recognizer>, String> {
        if let Some(why) = self.deaf_to(language) {
            return Err(why);
        }
        let mut held = self.held.lock().map_err(|_| "Voice is not well.")?;
        if Self::wants_whisper(language) {
            if held.whisper.is_none() {
                held.whisper = Some(Arc::new(Mutex::new(Whisper::open(
                    &self.folder(WHISPER_SET),
                )?)));
            }
            return held
                .whisper
                .clone()
                .ok_or_else(|| "Voice is not well.".into());
        }
        if held.parakeet.is_none() {
            let folder = self.folder(LISTEN_SET).join("parakeet");
            held.parakeet = Some(Arc::new(Mutex::new(Parakeet::open(&folder)?)));
        }
        held.parakeet
            .clone()
            .ok_or_else(|| "Voice is not well.".into())
    }

    fn mute_in(&self, voice: &str) -> Option<String> {
        if !self.store.installed_id(SPEAK_SET) {
            return Some(NOT_HERE_SPEAK.into());
        }
        let file = self.folder(SPEAK_SET).join(format!("voices/{voice}.bin"));
        (!crate::engine::kokoro::is_voice_name(voice) || !file.is_file())
            .then(|| format!("There is no voice named {voice}."))
    }

    fn synthesizer(&self) -> Result<Shared<dyn Synthesizer>, String> {
        if !self.store.installed_id(SPEAK_SET) {
            return Err(NOT_HERE_SPEAK.into());
        }
        let mut held = self.held.lock().map_err(|_| "Voice is not well.")?;
        if held.kokoro.is_none() {
            let folder = self.folder(SPEAK_SET);
            let kokoro = Kokoro::open(&folder.join("kokoro.onnx"), &folder.join("voices"))?;
            held.kokoro = Some(Arc::new(Mutex::new(kokoro)));
        }
        held.kokoro
            .clone()
            .ok_or_else(|| "Voice is not well.".into())
    }

    fn forget(&self, set: &str) {
        if let Ok(mut held) = self.held.lock() {
            match set {
                LISTEN_SET => held.parakeet = None,
                WHISPER_SET => held.whisper = None,
                SPEAK_SET => held.kokoro = None,
                _ => {}
            }
        }
    }

    fn rest(&self, now: Duration, idle: Duration) {
        if let Ok(mut held) = self.held.lock()
            && now.saturating_sub(held.used) >= idle
        {
            *held = Held {
                used: held.used,
                ..Held::default()
            };
        }
    }

    fn touch(&self, now: Duration) {
        if let Ok(mut held) = self.held.lock() {
            held.used = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_models_it_says_so_plainly() {
        let folder = tempfile::tempdir().unwrap();
        let loaded = Loaded::new(Store::new(folder.path()));
        assert_eq!(loaded.deaf_to(None).as_deref(), Some(NOT_HERE_LISTEN));
        assert_eq!(
            loaded.recognizer(Some("en")).err().as_deref(),
            Some(NOT_HERE_LISTEN)
        );
        assert_eq!(loaded.detector().err().as_deref(), Some(NOT_HERE_LISTEN));
        assert_eq!(loaded.mute_in("af_heart").as_deref(), Some(NOT_HERE_SPEAK));
        assert_eq!(loaded.synthesizer().err().as_deref(), Some(NOT_HERE_SPEAK));
    }

    #[test]
    fn whisper_is_for_what_parakeet_lacks() {
        assert!(!Loaded::wants_whisper(None));
        assert!(!Loaded::wants_whisper(Some("en-US")));
        assert!(!Loaded::wants_whisper(Some("PT_br")));
        assert!(Loaded::wants_whisper(Some("ja")));
        assert!(Loaded::wants_whisper(Some("zh-Hant")));
        assert_eq!(primary("pt-BR"), "pt");
    }
}
