use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::audio::pipewire::{Closer, Microphone, Sound, Speaker};
use crate::engine::vad::{FRAME, SpeechDetector};
use crate::engine::{Recognizer, Spoken, Synthesizer, Word};
use crate::service::clock::Clock;
use crate::service::engines::{Engines, Shared};

/// A frame of speech (loud) or of silence.
pub(super) fn frame(loud: bool) -> Vec<f32> {
    vec![if loud { 0.5 } else { 0.0 }; FRAME]
}

struct Loudness;

impl SpeechDetector for Loudness {
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        Ok(if frame[0] > 0.1 { 0.95 } else { 0.01 })
    }
}

/// Says how many frames of speech it was given, and in which language.
#[derive(Default)]
pub(super) struct Counter {
    pub(super) asked: Vec<(usize, Option<String>)>,
}

impl Recognizer for Counter {
    fn transcribe(&mut self, samples: &[f32], language: Option<&str>) -> Result<String, String> {
        self.asked
            .push((samples.len() / FRAME, language.map(str::to_owned)));
        Ok(format!("{} frames", samples.len() / FRAME))
    }
    fn longest(&self) -> usize {
        usize::MAX
    }
}

/// A tenth of a second of sound for each word; "fail" can't be said. It notes
/// how many speakers were open each time it was asked for a sentence.
struct Tenths(Arc<Played>);

impl Synthesizer for Tenths {
    fn speak(&mut self, sentence: &str, _voice: &str, _speed: f32) -> Result<Spoken, String> {
        let opened = self.0.opened.load(Ordering::SeqCst);
        self.0.opened_when_made.lock().unwrap().push(opened);
        if sentence.contains("fail") {
            return Err("That can't be said.".into());
        }
        let words: Vec<Word> = sentence
            .split_whitespace()
            .enumerate()
            .map(|(index, word)| Word {
                text: word.into(),
                start_ms: index as u64 * 100,
                end_ms: index as u64 * 100 + 100,
            })
            .collect();
        Ok(Spoken {
            samples: vec![0.25; words.len() * 2400],
            words,
        })
    }
}

pub(super) struct FakeEngines {
    pub(super) here: AtomicBool,
    pub(super) counter: Arc<Mutex<Counter>>,
    pub(super) forgotten: Mutex<Vec<String>>,
    pub(super) played: Arc<Played>,
}

impl Engines for FakeEngines {
    fn deaf_to(&self, language: Option<&str>) -> Option<String> {
        if !self.here.load(Ordering::SeqCst) {
            return Some(
                "Voice can't listen yet: its listening models are not on this computer.".into(),
            );
        }
        (language == Some("tlh")).then(|| "Voice can't hear tlh yet.".into())
    }
    fn detector(&self) -> Result<Box<dyn SpeechDetector>, String> {
        Ok(Box::new(Loudness))
    }
    fn recognizer(&self, _language: Option<&str>) -> Result<Shared<dyn Recognizer>, String> {
        Ok(self.counter.clone())
    }
    fn mute_in(&self, voice: &str) -> Option<String> {
        if !self.here.load(Ordering::SeqCst) {
            return Some(
                "Voice can't speak yet: its speaking models are not on this computer.".into(),
            );
        }
        (voice == "nobody").then(|| "There is no voice named nobody.".into())
    }
    fn synthesizer(&self) -> Result<Shared<dyn Synthesizer>, String> {
        Ok(Arc::new(Mutex::new(Tenths(self.played.clone()))))
    }
    fn forget(&self, set: &str) {
        self.forgotten.lock().unwrap().push(set.to_owned());
    }
    fn rest(&self, _now: Duration, _idle: Duration) {}
    fn touch(&self, _now: Duration) {}
}

/// A microphone the test feeds a frame at a time; it ends when closed or when the test lets go of it.
pub(super) struct FedMicrophone {
    pub(super) frames: Receiver<Vec<f32>>,
    pub(super) closed: Arc<AtomicBool>,
}

impl Microphone for FedMicrophone {
    fn read(&mut self, frame: &mut [f32]) -> Result<bool, String> {
        loop {
            if self.closed.load(Ordering::SeqCst) {
                return Ok(false);
            }
            match self.frames.recv_timeout(Duration::from_millis(2)) {
                Ok(next) => {
                    frame.copy_from_slice(&next);
                    return Ok(true);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(_) => return Ok(false),
            }
        }
    }
    fn closer(&self) -> Closer {
        let closed = self.closed.clone();
        Arc::new(move || closed.store(true, Ordering::SeqCst))
    }
}

type Hook = Box<dyn Fn() + Send + Sync>;

#[derive(Default)]
pub(super) struct Played {
    pub(super) samples: AtomicUsize,
    /// Speakers opened so far, and how many were open each time a sentence was asked for.
    pub(super) opened: AtomicUsize,
    pub(super) opened_when_made: Mutex<Vec<usize>>,
    pub(super) closed: AtomicBool,
    pub(super) finished: AtomicBool,
    /// Called once this many samples were written.
    pub(super) at: AtomicUsize,
    pub(super) hook: Mutex<Option<Hook>>,
}

struct KeptSpeaker(Arc<Played>);

impl Speaker for KeptSpeaker {
    fn write(&mut self, samples: &[f32]) -> Result<(), String> {
        let before = self.0.samples.fetch_add(samples.len(), Ordering::SeqCst);
        let at = self.0.at.load(Ordering::SeqCst);
        if at > 0
            && before < at
            && before + samples.len() >= at
            && let Some(hook) = self.0.hook.lock().unwrap().as_ref()
        {
            hook();
        }
        Ok(())
    }
    fn closer(&self) -> Closer {
        let played = self.0.clone();
        Arc::new(move || played.closed.store(true, Ordering::SeqCst))
    }
    fn finish(self: Box<Self>) {
        self.0.finished.store(true, Ordering::SeqCst);
    }
}

pub(super) struct FakeSound {
    pub(super) microphones: Mutex<Vec<FedMicrophone>>,
    pub(super) played: Arc<Played>,
}

impl Sound for FakeSound {
    fn microphone(&self) -> Result<Box<dyn Microphone>, String> {
        let microphone = self.microphones.lock().unwrap().pop();
        microphone
            .map(|m| Box::new(m) as Box<dyn Microphone>)
            .ok_or_else(|| "The microphone can't be opened.".into())
    }
    fn speaker(&self) -> Result<Box<dyn Speaker>, String> {
        self.played.opened.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(KeptSpeaker(self.played.clone())))
    }
}

/// Moves only when something sleeps.
#[derive(Default)]
pub(super) struct Sleepy(Mutex<Duration>);

impl Clock for Sleepy {
    fn now(&self) -> Duration {
        *self.0.lock().unwrap()
    }
    fn sleep(&self, time: Duration) {
        *self.0.lock().unwrap() += time;
    }
}
