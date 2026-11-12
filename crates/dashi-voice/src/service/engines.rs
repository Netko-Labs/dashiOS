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

/// The models in memory, each behind its own lock: loading one (a second or
/// two) never keeps another from being used or loaded meanwhile, so the
/// speaking model can load while the listening one hears.
#[derive(Default)]
struct Held {
    parakeet: Mutex<Option<Shared<dyn Recognizer>>>,
    whisper: Mutex<Option<Shared<dyn Recognizer>>>,
    kokoro: Mutex<Option<Shared<dyn Synthesizer>>>,
    used: Mutex<Duration>,
}

pub(crate) struct Loaded {
    store: Store,
    held: Held,
}

/// The model in `slot`, opened first if it is not in memory.
fn held_or_open<T: ?Sized>(
    slot: &Mutex<Option<Shared<T>>>,
    open: impl FnOnce() -> Result<Shared<T>, String>,
) -> Result<Shared<T>, String> {
    let mut slot = slot.lock().map_err(|_| "Voice is not well.")?;
    if let Some(model) = slot.as_ref() {
        return Ok(model.clone());
    }
    let model = open()?;
    *slot = Some(model.clone());
    Ok(model)
}

/// Let go of the model in `slot`; whether there was one.
fn let_go<T: ?Sized>(slot: &Mutex<Option<Shared<T>>>) -> bool {
    slot.lock().is_ok_and(|mut slot| slot.take().is_some())
}

const NOT_HERE_LISTEN: &str =
    "Voice can't listen yet: its listening models are not on this computer.";
const NOT_HERE_SPEAK: &str = "Voice can't speak yet: its speaking models are not on this computer.";

impl Loaded {
    pub(crate) fn new(store: Store) -> Self {
        Self {
            store,
            held: Held::default(),
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
        if Self::wants_whisper(language) {
            return held_or_open(&self.held.whisper, || {
                let whisper: Shared<dyn Recognizer> =
                    Arc::new(Mutex::new(Whisper::open(&self.folder(WHISPER_SET))?));
                Ok(whisper)
            });
        }
        held_or_open(&self.held.parakeet, || {
            let folder = self.folder(LISTEN_SET).join("parakeet");
            let parakeet: Shared<dyn Recognizer> = Arc::new(Mutex::new(Parakeet::open(&folder)?));
            Ok(parakeet)
        })
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
        held_or_open(&self.held.kokoro, || {
            let folder = self.folder(SPEAK_SET);
            let kokoro = Kokoro::open(&folder.join("kokoro.onnx"), &folder.join("voices"))?;
            let kokoro: Shared<dyn Synthesizer> = Arc::new(Mutex::new(kokoro));
            Ok(kokoro)
        })
    }

    fn forget(&self, set: &str) {
        match set {
            LISTEN_SET => {
                let_go(&self.held.parakeet);
            }
            WHISPER_SET => {
                let_go(&self.held.whisper);
            }
            SPEAK_SET => {
                let_go(&self.held.kokoro);
            }
            _ => {}
        }
    }

    fn rest(&self, now: Duration, idle: Duration) {
        let used = self.held.used.lock().map_or(now, |used| *used);
        if now.saturating_sub(used) < idle {
            return;
        }
        // Every slot is asked: `|` and not `||`, so none is skipped once one had a model.
        let had =
            let_go(&self.held.parakeet) | let_go(&self.held.whisper) | let_go(&self.held.kokoro);
        if had {
            // SAFETY: malloc_trim takes a pad size and touches no memory of ours;
            // it hands the freed models' pages back to the system.
            unsafe { libc::malloc_trim(0) };
        }
    }

    fn touch(&self, now: Duration) {
        if let Ok(mut used) = self.held.used.lock() {
            *used = now;
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
