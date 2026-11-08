//! The speaking thread: Kokoro, a sentence at a time, into `pw-play`.
//! A stop ends the current utterance and drops the queued ones; the
//! playback child is stopped by its own pid.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
        mpsc::{Receiver, Sender, channel},
    },
    thread,
    time::Instant,
};

use serde_json::json;

use crate::{
    audio::{self, Playback},
    engine::Msg,
    models::Paths,
    outbox::Outbox,
    phonemes,
    protocol::event,
    tts::Kokoro,
};

pub(crate) struct Job {
    pub utterance: String,
    pub text: String,
    pub voice: String,
    pub lang: String,
    pub speed: f32,
}

#[derive(Clone)]
pub(crate) struct Speaker {
    jobs: Sender<(u64, Job)>,
    generation: Arc<AtomicU64>,
    playing: Arc<Mutex<Option<u32>>>,
}

impl Speaker {
    pub(crate) fn start(models: std::path::PathBuf, outbox: Outbox, engine: Sender<Msg>) -> Self {
        let (jobs, receiver) = channel();
        let speaker = Self {
            jobs,
            generation: Arc::default(),
            playing: Arc::default(),
        };
        let worker = speaker.clone();
        let spawned = thread::Builder::new()
            .name("speaker".into())
            .spawn(move || worker.run(receiver, Paths { root: models }, outbox, engine));
        if let Err(error) = spawned {
            eprintln!("dashi-voice: no speaking thread: {error}");
        }
        speaker
    }

    pub(crate) fn say(&self, job: Job) {
        let _ = self
            .jobs
            .send((self.generation.load(Ordering::SeqCst), job));
    }

    /// Stop now, and forget what was queued.
    pub(crate) fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(playing) = self.playing.lock()
            && let Some(pid) = *playing
        {
            audio::stop_child(pid);
        }
    }

    fn run(&self, jobs: Receiver<(u64, Job)>, paths: Paths, outbox: Outbox, engine: Sender<Msg>) {
        let mut kokoro: Option<Kokoro> = None;
        while let Ok((generation, job)) = jobs.recv() {
            if generation != self.generation.load(Ordering::SeqCst) {
                outbox.send(&event(
                    "spoken",
                    json!({ "utterance": job.utterance, "interrupted": true }),
                ));
                continue;
            }
            if kokoro.is_none() {
                match Kokoro::load(Paths {
                    root: paths.root.clone(),
                }) {
                    Ok(loaded) => kokoro = Some(loaded),
                    Err(error) => {
                        outbox.send(&event("error", json!({ "message": error })));
                        outbox.send(&event(
                            "spoken",
                            json!({ "utterance": job.utterance, "interrupted": true }),
                        ));
                        continue;
                    }
                }
            }
            let Some(model) = kokoro.as_mut() else {
                continue;
            };
            let _ = engine.send(Msg::Speaking(true));
            let interrupted = self.speak(model, &job, generation, &outbox);
            let _ = engine.send(Msg::Speaking(false));
            outbox.send(&event(
                "spoken",
                json!({ "utterance": job.utterance, "interrupted": interrupted }),
            ));
        }
    }

    /// Says one job; whether it was cut short.
    fn speak(&self, model: &mut Kokoro, job: &Job, generation: u64, outbox: &Outbox) -> bool {
        let stopped = || generation != self.generation.load(Ordering::SeqCst);
        let mut playback = match Playback::start() {
            Ok(playback) => playback,
            Err(error) => {
                outbox.send(&event(
                    "error",
                    json!({ "message": format!("pw-play: {error}") }),
                ));
                return true;
            }
        };
        if let Ok(mut playing) = self.playing.lock() {
            *playing = Some(playback.pid());
        }
        let mut cut = false;
        for sentence in phonemes::sentences(&job.text) {
            if stopped() {
                cut = true;
                break;
            }
            let started = Instant::now();
            let samples = match model.say(&sentence, &job.lang, &job.voice, job.speed) {
                Ok(samples) => samples,
                Err(error) => {
                    outbox.send(&event("error", json!({ "message": error })));
                    cut = true;
                    break;
                }
            };
            let seconds = samples.len() as f32 / audio::SPEAK_RATE as f32;
            outbox.send(&event(
                "speaking",
                json!({
                    "utterance": job.utterance,
                    "text": sentence,
                    "seconds": seconds,
                    "synthMs": started.elapsed().as_millis() as u64,
                }),
            ));
            if playback.write(&samples).is_err() || stopped() {
                cut = true;
                break;
            }
        }
        // No one may signal the child once it can be reaped.
        if let Ok(mut playing) = self.playing.lock() {
            *playing = None;
        }
        if cut {
            drop(playback);
            return true;
        }
        playback.finish_unless(stopped) || stopped()
    }
}
