//! The service's one decision loop: requests from the shell, the microphone's
//! frames, and the speaker's comings and goings. It owns the listening
//! models (Silero, Parakeet); the speaker thread owns Kokoro.

use std::{
    sync::mpsc::{Receiver, Sender},
    time::Instant,
};

use serde_json::{Value, json};

use crate::{
    audio::{self, Capture, LISTEN_RATE},
    models::Paths,
    outbox::Outbox,
    protocol::{Command, ListenMode, Request, event, reply_error, reply_ok},
    segmenter::{self, FRAME, Segmenter, Tuning},
    speaker::{Job, Speaker},
    stt::Parakeet,
    vad::Vad,
};

pub(crate) enum Msg {
    Request(Request),
    /// Samples from the microphone; `generation` names the capture they came from.
    Audio {
        generation: u64,
        samples: Vec<f32>,
    },
    /// The speaker began or ended an utterance.
    Speaking(bool),
    /// The shell went away.
    ClientGone,
}

/// Kept before speech starts and after it ends, so no word is clipped.
const PRE_ROLL_FRAMES: u32 = segmenter::ms_to_frames(300);
const POST_ROLL_FRAMES: u32 = segmenter::ms_to_frames(200);
/// A turn waits this long for an answer by default.
const TURN_WAIT_MS: u32 = 8_000;
const TURN_SILENCE_MS: u32 = 800;
/// Samples kept while watching for an interruption: three seconds.
const BARGE_KEEP: usize = 3 * LISTEN_RATE as usize;

struct Listening {
    mode: ListenMode,
    segmenter: Segmenter,
    samples: Vec<f32>,
}

pub(crate) struct Engine {
    paths: Paths,
    outbox: Outbox,
    sender: Sender<Msg>,
    speaker: Speaker,
    stt: Option<Parakeet>,
    vad: Option<Vad>,
    capture: Option<Capture>,
    capture_generation: u64,
    pending: Vec<f32>,
    listening: Option<Listening>,
    /// Watching for someone talking over Dashi.
    barge: Option<(Segmenter, Vec<f32>)>,
    speaking: bool,
    interrupt_by_speaking: bool,
    frames: u64,
}

impl Engine {
    pub(crate) fn new(paths: Paths, outbox: Outbox, sender: Sender<Msg>) -> Self {
        let speaker = Speaker::start(paths.root.clone(), outbox.clone(), sender.clone());
        Self {
            paths,
            outbox,
            sender,
            speaker,
            stt: None,
            vad: None,
            capture: None,
            capture_generation: 0,
            pending: Vec::new(),
            listening: None,
            barge: None,
            speaking: false,
            interrupt_by_speaking: true,
            frames: 0,
        }
    }

    pub(crate) fn run(mut self, receiver: Receiver<Msg>) {
        self.load();
        while let Ok(message) = receiver.recv() {
            match message {
                Msg::Request(request) => self.request(request),
                Msg::Audio {
                    generation,
                    samples,
                } if generation == self.capture_generation => self.audio(&samples),
                Msg::Audio { .. } => {}
                Msg::Speaking(on) => {
                    self.speaking = on;
                    self.barge = None;
                    self.update_capture();
                }
                Msg::ClientGone => {
                    self.speaker.stop();
                    self.listening = None;
                    self.update_capture();
                }
            }
        }
    }

    fn status(&self) -> Value {
        json!({
            "listen": self.stt.is_some() && self.vad.is_some(),
            "speak": self.paths.can_speak(),
            "listening": self.listening.as_ref().map(|listening| listening.mode.name()),
            "speaking": self.speaking,
            "models": self.paths.root,
        })
    }

    /// Load the listening models if they are there (at start, and after a download).
    fn load(&mut self) {
        if self.paths.can_listen() && (self.stt.is_none() || self.vad.is_none()) {
            let started = Instant::now();
            match Vad::load(&self.paths).and_then(|vad| Ok((vad, Parakeet::load(&self.paths)?))) {
                Ok((vad, stt)) => {
                    self.vad = Some(vad);
                    self.stt = Some(stt);
                    eprintln!(
                        "dashi-voice: listening models loaded in {} ms",
                        started.elapsed().as_millis()
                    );
                }
                Err(error) => self
                    .outbox
                    .send(&event("error", json!({ "message": error }))),
            }
        }
        self.outbox.send(&event("models", self.status()));
    }

    fn request(&mut self, Request { id, command }: Request) {
        let reply = match command {
            Command::Status => Ok(self.status()),
            Command::Load => {
                self.load();
                Ok(self.status())
            }
            Command::Config {
                interrupt_by_speaking,
            } => {
                self.interrupt_by_speaking = interrupt_by_speaking;
                self.update_capture();
                Ok(json!({}))
            }
            Command::Listen {
                mode,
                wait_ms,
                silence_ms,
            } => self.listen(mode, wait_ms, silence_ms),
            Command::ListenEnd => {
                self.end_listening(None);
                Ok(json!({}))
            }
            Command::ListenCancel => {
                if self.listening.take().is_some() {
                    self.outbox.send(&event(
                        "listening",
                        json!({ "on": false, "cancelled": true }),
                    ));
                }
                self.update_capture();
                Ok(json!({}))
            }
            Command::Speak {
                utterance,
                text,
                voice,
                lang,
                speed,
            } => {
                self.speaker.say(Job {
                    utterance,
                    text,
                    voice,
                    lang: lang.unwrap_or_else(|| "en".into()),
                    speed: speed.unwrap_or(1.0),
                });
                Ok(json!({}))
            }
            Command::StopSpeaking => {
                self.speaker.stop();
                Ok(json!({}))
            }
        };
        self.outbox.send(&match reply {
            Ok(result) => reply_ok(id, result),
            Err(error) => reply_error(Some(id), &error),
        });
    }

    fn listen(
        &mut self,
        mode: ListenMode,
        wait_ms: Option<u32>,
        silence_ms: Option<u32>,
    ) -> Result<Value, String> {
        if self.stt.is_none() || self.vad.is_none() {
            return Err("The voice models aren't downloaded yet.".into());
        }
        // Listening always takes over from speaking: the key interrupts.
        self.speaker.stop();
        let tuning = match mode {
            ListenMode::Hold => Tuning::hold(),
            ListenMode::Turn => Tuning::turn(
                wait_ms.unwrap_or(TURN_WAIT_MS).clamp(1_000, 60_000),
                silence_ms.unwrap_or(TURN_SILENCE_MS).clamp(300, 3_000),
            ),
        };
        if let Some(vad) = self.vad.as_mut() {
            vad.reset();
        }
        self.listening = Some(Listening {
            mode,
            segmenter: Segmenter::new(tuning),
            samples: Vec::new(),
        });
        self.update_capture();
        if self.capture.is_none() {
            self.listening = None;
            return Err("The microphone didn't open.".into());
        }
        self.outbox.send(&event(
            "listening",
            json!({ "on": true, "mode": mode.name() }),
        ));
        Ok(json!({}))
    }

    /// The microphone is open while Dashi listens, or speaks and may be interrupted.
    fn update_capture(&mut self) {
        let barge_in = self.speaking
            && self.interrupt_by_speaking
            && self.vad.is_some()
            && self.listening.is_none();
        if !barge_in {
            self.barge = None;
        } else if self.barge.is_none() {
            self.barge = Some((Segmenter::new(Tuning::barge_in()), Vec::new()));
        }
        let wanted = self.listening.is_some() || barge_in;
        if wanted && self.capture.is_none() {
            self.capture_generation += 1;
            self.pending.clear();
            let generation = self.capture_generation;
            match Capture::start(self.sender.clone(), move |samples| Msg::Audio {
                generation,
                samples,
            }) {
                Ok(capture) => self.capture = Some(capture),
                Err(error) => self.outbox.send(&event(
                    "error",
                    json!({ "message": format!("pw-record: {error}") }),
                )),
            }
        } else if !wanted && self.capture.is_some() {
            self.capture = None;
            self.capture_generation += 1;
        }
    }

    fn audio(&mut self, samples: &[f32]) {
        self.pending.extend_from_slice(samples);
        let mut offset = 0;
        while self.pending.len() - offset >= FRAME {
            let frame: Vec<f32> = self.pending[offset..offset + FRAME].to_vec();
            offset += FRAME;
            self.frame(&frame);
        }
        self.pending.drain(..offset);
    }

    fn frame(&mut self, frame: &[f32]) {
        let Some(vad) = self.vad.as_mut() else { return };
        let probability = match vad.probability(frame) {
            Ok(probability) => probability,
            Err(error) => {
                self.outbox
                    .send(&event("error", json!({ "message": error })));
                0.0
            }
        };
        self.frames += 1;
        if let Some((segmenter, kept)) = self.barge.as_mut() {
            kept.extend_from_slice(frame);
            // Only the last few seconds can matter.
            if kept.len() > BARGE_KEEP {
                kept.drain(..kept.len() - BARGE_KEEP);
            }
            if let Some(segmenter::Event::Started { at }) = segmenter.push(probability) {
                let frames = (segmenter.frames() - at + PRE_ROLL_FRAMES) as usize;
                let said = kept[kept.len().saturating_sub(frames * FRAME)..].to_vec();
                self.barge = None;
                self.speaker.stop();
                self.outbox
                    .send(&event("interrupted", json!({ "by": "voice" })));
                // What they said over Dashi is the start of a turn.
                let mut segmenter = Segmenter::new(Tuning::turn(TURN_WAIT_MS, TURN_SILENCE_MS));
                for _ in 0..(said.len() / FRAME) {
                    segmenter.push(1.0);
                }
                self.listening = Some(Listening {
                    mode: ListenMode::Turn,
                    segmenter,
                    samples: said,
                });
                self.outbox.send(&event(
                    "listening",
                    json!({ "on": true, "mode": "turn", "barge": true }),
                ));
            }
            return;
        }
        let Some(listening) = self.listening.as_mut() else {
            return;
        };
        listening.samples.extend_from_slice(frame);
        let level = audio::level(frame);
        let pushed = listening.segmenter.push(probability);
        if self.frames.is_multiple_of(3) {
            self.outbox.send(&event(
                "level",
                json!({ "level": (level * 100.0).round() / 100.0 }),
            ));
        }
        match pushed {
            Some(segmenter::Event::Ended { from, to }) => self.end_listening(Some((from, to))),
            Some(segmenter::Event::NoSpeech) => self.end_listening(None),
            _ => {}
        }
    }

    /// The turn is over (silence, the key let go, or nothing said): transcribe it.
    fn end_listening(&mut self, span: Option<(u32, u32)>) {
        let Some(mut listening) = self.listening.take() else {
            return;
        };
        self.update_capture();
        let span = span.or(match listening.segmenter.finish() {
            segmenter::Event::Ended { from, to } => Some((from, to)),
            _ => None,
        });
        let mode = listening.mode.name();
        self.outbox
            .send(&event("listening", json!({ "on": false, "mode": mode })));
        let Some((from, to)) = span else {
            self.outbox.send(&event(
                "heard",
                json!({ "text": "", "mode": mode, "reason": "silence" }),
            ));
            return;
        };
        let start = (from.saturating_sub(PRE_ROLL_FRAMES) as usize) * FRAME;
        let end = ((to + POST_ROLL_FRAMES) as usize * FRAME).min(listening.samples.len());
        let speech = listening
            .samples
            .drain(start.min(end)..end)
            .collect::<Vec<_>>();
        let Some(stt) = self.stt.as_mut() else { return };
        let started = Instant::now();
        let result = stt.transcribe(&speech);
        let elapsed = started.elapsed().as_millis() as u64;
        let speech_ms = (speech.len() as u64 * 1000) / u64::from(LISTEN_RATE);
        match result {
            Ok(text) => self.outbox.send(&event(
                "heard",
                json!({ "text": text, "mode": mode, "speechMs": speech_ms, "elapsedMs": elapsed }),
            )),
            Err(error) => {
                self.outbox
                    .send(&event("error", json!({ "message": error })));
                self.outbox.send(&event(
                    "heard",
                    json!({ "text": "", "mode": mode, "reason": "error" }),
                ));
            }
        }
    }
}
