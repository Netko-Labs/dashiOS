//! Listening: the microphone is opened when asked and closed when told, when
//! the person goes quiet (if asked to end so), when the connection that
//! asked goes away, or after five minutes whatever happens. The gate keeps
//! the speech; when the listen ends, the model turns it into words.

use std::sync::atomic::{AtomicU8, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, sync_channel};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::Service;
use super::capture::{TAIL, capture, quiet_of};
use crate::audio::LISTEN_RATE;
use crate::audio::pipewire::{Closer, Microphone};
use crate::engine::gate::Gate;
use crate::engine::vad::SpeechDetector;
use crate::protocol::{Event, Listen, Quiet, Until};

pub(super) const RUNNING: u8 = 0;
pub(super) const STOPPING: u8 = 1;
pub(super) const CANCELLED: u8 = 2;

/// How long `listen.stop` waits for the microphone before closing it by force.
const PATIENCE: Duration = Duration::from_millis(600);
/// How long a microphone may give no sound at all before the listen gives up.
const DEAF: Duration = Duration::from_secs(3);
/// How long it waits for the words.
const THINK: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct Heard {
    text: String,
    speech_ms: u64,
}

pub(super) struct Run {
    owner: u64,
    pub(super) mode: AtomicU8,
    /// How long a quiet ends the listen, in ms; 0 while only `listen.stop` ends it.
    pub(super) quiet: AtomicU64,
    pub(super) frames: AtomicUsize,
    close: Closer,
    done: Mutex<Option<Result<Heard, String>>>,
    told: Condvar,
}

#[derive(Default)]
pub(super) struct Listening {
    run: Mutex<Option<Arc<Run>>>,
}

impl Listening {
    fn current(&self) -> Option<Arc<Run>> {
        self.run.lock().ok()?.clone()
    }
}

impl Service {
    pub(super) fn listen(
        self: &Arc<Self>,
        connection: u64,
        params: Listen,
    ) -> Result<Value, String> {
        if let Some(why) = self.engines.deaf_to(params.language.as_deref()) {
            return Err(why);
        }
        let mut slot = self
            .listening
            .run
            .lock()
            .map_err(|_| "Voice is not well.")?;
        if slot.is_some() {
            return Err("Voice is already listening.".into());
        }
        // The person talks: whatever was being said stops.
        self.speak_stop();
        let detector = self.engines.detector()?;
        let microphone = self.sound.microphone()?;
        let run = Arc::new(Run {
            owner: connection,
            mode: AtomicU8::new(RUNNING),
            quiet: AtomicU64::new(match params.until {
                Until::Silence => quiet_of(params.quiet_ms),
                Until::Stop => 0,
            }),
            frames: AtomicUsize::new(0),
            close: microphone.closer(),
            done: Mutex::new(None),
            told: Condvar::new(),
        });
        *slot = Some(run.clone());
        drop(slot);
        self.act(|activity| activity.listening = true);
        let service = self.clone();
        std::thread::spawn(move || service.hear(&run, microphone, detector, &params));
        Ok(json!({}))
    }

    /// The whole of one listen, on its own thread.
    fn hear(
        self: &Arc<Self>,
        run: &Arc<Run>,
        microphone: Box<dyn Microphone>,
        detector: Box<dyn SpeechDetector>,
        params: &Listen,
    ) {
        let language = params.language.clone();
        let (partials, speech) = sync_channel::<Vec<f32>>(1);
        let worker = (params.partials != Some(false)).then(|| {
            let (service, run, language) = (self.clone(), run.clone(), language.clone());
            std::thread::spawn(move || service.partials(&run, &speech, language.as_deref()))
        });
        // The model is loaded while the person talks, not after.
        let warm = self.clone();
        let warm_language = language.clone();
        std::thread::spawn(move || warm.engines.recognizer(warm_language.as_deref()).is_ok());
        // A microphone that gives nothing in three seconds is closed, so the listen ends in words.
        let watched = run.clone();
        std::thread::spawn(move || {
            std::thread::sleep(DEAF);
            if watched.frames.load(Ordering::SeqCst) == 0 {
                (watched.close)();
            }
        });
        let captured = capture(self, run, microphone, detector, &partials);
        drop(partials);
        if let Some(worker) = worker {
            let _ = worker.join();
        }
        let cancelled = run.mode.load(Ordering::SeqCst) == CANCELLED;
        self.act(|activity| {
            activity.listening = false;
            activity.thinking += usize::from(!cancelled);
        });
        let result = if cancelled {
            Err("The listen was cancelled.".to_owned())
        } else {
            captured.and_then(|gate| self.words(&gate, language.as_deref()))
        };
        // The slot is freed before anyone is told: a listen asked for on `heard` is never refused.
        if let Ok(mut slot) = self.listening.run.lock()
            && slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, run))
        {
            *slot = None;
        }
        if !cancelled {
            match &result {
                Ok(heard) => self.hub.emit(&Event::Heard {
                    text: heard.text.clone(),
                    speech_ms: heard.speech_ms,
                }),
                Err(error) => self.hub.emit(&Event::Error {
                    message: error.clone(),
                }),
            }
            self.act(|activity| activity.thinking -= 1);
        }
        if let Ok(mut done) = run.done.lock() {
            *done = Some(result);
        }
        run.told.notify_all();
    }

    /// The speech as words.
    fn words(&self, gate: &Gate, language: Option<&str>) -> Result<Heard, String> {
        let speech_ms = gate.speech().len() as u64 * 1000 / u64::from(LISTEN_RATE);
        if !gate.heard() {
            return Ok(Heard {
                text: String::new(),
                speech_ms: 0,
            });
        }
        let recognizer = self.engines.recognizer(language)?;
        let mut recognizer = recognizer.lock().map_err(|_| "Voice is not well.")?;
        let text = crate::engine::transcribe(&mut *recognizer, gate.speech(), language)?;
        Ok(Heard { text, speech_ms })
    }

    /// Words as they come: the speech so far, each time the listen hands some over.
    fn partials(&self, run: &Run, speech: &Receiver<Vec<f32>>, language: Option<&str>) {
        let mut last = String::new();
        for speech in speech {
            let Ok(recognizer) = self.engines.recognizer(language) else {
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

    pub(super) fn listen_stop(&self) -> Result<Value, String> {
        let run = self.listening.current().ok_or("Voice is not listening.")?;
        let _ = run
            .mode
            .compare_exchange(RUNNING, STOPPING, Ordering::SeqCst, Ordering::SeqCst);
        let done = run.done.lock().map_err(|_| "Voice is not well.")?;
        // A microphone that gives no sound never sees the stop: close it.
        let frames = run.frames.load(Ordering::SeqCst);
        let (done, _) = run
            .told
            .wait_timeout_while(done, PATIENCE, |done| {
                done.is_none() && run.frames.load(Ordering::SeqCst) < frames + TAIL
            })
            .map_err(|_| "Voice is not well.")?;
        if done.is_none() && run.frames.load(Ordering::SeqCst) < frames + TAIL {
            (run.close)();
        }
        let (done, _) = run
            .told
            .wait_timeout_while(done, THINK, |done| done.is_none())
            .map_err(|_| "Voice is not well.")?;
        match done.clone() {
            Some(Ok(heard)) => Ok(json!({ "text": heard.text, "speech_ms": heard.speech_ms })),
            Some(Err(error)) => Err(error),
            None => Err("Voice took too long to work out the words.".into()),
        }
    }

    /// From now on the listen under way ends by itself, once the person has spoken and
    /// then been quiet: a key that was tapped, not held, has no coming up to end it.
    pub(super) fn listen_quiet(&self, quiet: &Quiet) -> Result<Value, String> {
        let run = self.listening.current().ok_or("Voice is not listening.")?;
        run.quiet.store(quiet_of(quiet.quiet_ms), Ordering::SeqCst);
        Ok(json!({}))
    }

    /// Drop a listen and what it heard; with a connection, only that connection's.
    pub(super) fn listen_cancel(&self, owner: Option<u64>) {
        let Some(run) = self.listening.current() else {
            return;
        };
        if owner.is_none_or(|owner| owner == run.owner) {
            run.mode.store(CANCELLED, Ordering::SeqCst);
            (run.close)();
        }
    }
}
