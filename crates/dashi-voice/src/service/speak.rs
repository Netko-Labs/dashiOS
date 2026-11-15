//! Speaking: one thread says what is asked, a sentence at a time. Each
//! sentence is made into sound while the one before plays; the sound is
//! written a little ahead of when it plays, so stopping is at once, and each
//! sentence's event is sent as its first sound plays, for captions in step.

use std::collections::VecDeque;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::Service;
use super::lines::{Line, lines};
use super::player::Player;
use super::seam::{joined, seams};
use crate::audio::pipewire::Closer;
use crate::engine::Spoken;
use crate::protocol::{Ended, Event, Speak};

/// The most text at once.
const MOST_TEXT: usize = 20_000;

struct Utterance {
    id: u64,
    /// Each sentence with the voice that says it.
    lines: Vec<Line>,
    /// The first two lines are one long sentence, said in two parts.
    cut: bool,
    speed: f32,
}

/// `DASHI_VOICE_DEBUG=speak` writes each sentence's voice, language and
/// phonemes to the service's log. Off unless asked for: the log is otherwise
/// never given what was said.
fn debugging() -> bool {
    std::env::var("DASHI_VOICE_DEBUG").is_ok_and(|what| what.split(',').any(|one| one == "speak"))
}

#[derive(Default)]
struct Queue {
    waiting: VecDeque<Utterance>,
    /// Goes up at every stop: what was being said then is stale.
    generation: u64,
    last_id: u64,
    /// Closes the speakers of what is being said now.
    close: Option<Closer>,
}

#[derive(Default)]
pub(super) struct Speech {
    queue: Mutex<Queue>,
    wake: Condvar,
}

/// A sentence, made: its place, its line (words and voice), its sound.
pub(super) type Made = Result<(usize, Line, Spoken), String>;

/// The speaking thread.
pub(super) fn start(service: &Arc<Service>) {
    let service = Arc::downgrade(service);
    std::thread::spawn(move || {
        loop {
            let Some(service) = service.upgrade() else {
                return;
            };
            let Some((utterance, generation)) = service.next_utterance() else {
                continue;
            };
            service.say(&utterance, generation);
        }
    });
}

impl Service {
    pub(super) fn speak(&self, params: Speak) -> Result<Value, String> {
        let parts = params.parts.iter().flatten();
        let length = params.text.len() + parts.map(|part| part.text.len()).sum::<usize>();
        if length > MOST_TEXT {
            return Err("That is too much to say at once.".into());
        }
        let (lines, cut) = lines(&params)?;
        // Every voice that will speak is here, or nothing is said. With nothing to say, the voice asked for.
        let asked = params.voice.as_deref().into_iter();
        let mut voices: Vec<&str> = lines.iter().map(|line| line.voice.as_str()).collect();
        voices.extend(asked.filter(|_| lines.is_empty()));
        if voices.is_empty() {
            voices.push(super::voices::DEFAULT);
        }
        voices.sort_unstable();
        voices.dedup();
        if let Some(why) = voices.iter().find_map(|voice| self.engines.mute_in(voice)) {
            return Err(why);
        }
        if !params.queue {
            self.speak_stop();
        }
        let mut queue = self.speech.queue.lock().map_err(|_| "Voice is not well.")?;
        queue.last_id += 1;
        let id = queue.last_id;
        queue.waiting.push_back(Utterance {
            id,
            lines,
            cut,
            speed: params.speed.unwrap_or(1.0).clamp(0.5, 2.0),
        });
        drop(queue);
        self.speech.wake.notify_all();
        Ok(json!({ "id": id }))
    }

    /// Stop what is being said, at once, and forget what was waiting.
    pub(super) fn speak_stop(&self) {
        let Ok(mut queue) = self.speech.queue.lock() else {
            return;
        };
        queue.generation += 1;
        let close = queue.close.take();
        let waiting: Vec<u64> = queue
            .waiting
            .drain(..)
            .map(|utterance| utterance.id)
            .collect();
        drop(queue);
        if let Some(close) = close {
            close();
        }
        for id in waiting {
            self.hub.emit(&Event::Spoken {
                id,
                reason: Ended::Stopped,
                error: None,
            });
        }
    }

    /// The next thing to say; none after a while with nothing, so the thread can see the service go.
    fn next_utterance(&self) -> Option<(Utterance, u64)> {
        let queue = self.speech.queue.lock().ok()?;
        let (mut queue, _) = self
            .speech
            .wake
            .wait_timeout_while(queue, Duration::from_secs(1), |queue| {
                queue.waiting.is_empty()
            })
            .ok()?;
        let utterance = queue.waiting.pop_front()?;
        Some((utterance, queue.generation))
    }

    /// Let a stop close these speakers; false when what they are for was stopped already.
    pub(super) fn closes(&self, generation: u64, close: Closer) -> bool {
        let Ok(mut queue) = self.speech.queue.lock() else {
            return false;
        };
        if queue.generation != generation {
            return false;
        }
        queue.close = Some(close);
        true
    }

    pub(super) fn stale(&self, generation: u64) -> bool {
        self.speech
            .queue
            .lock()
            .map_or(true, |queue| queue.generation != generation)
    }

    /// Say one utterance to its end, or until it is stopped.
    fn say(self: &Arc<Self>, utterance: &Utterance, generation: u64) {
        self.act(|activity| activity.thinking += 1);
        // The first sentence in two parts when it is long: the first sound waits for less.
        let (lines, cut) = (utterance.lines.clone(), utterance.cut);
        let seams = seams(&lines);
        let any = !lines.is_empty();
        let (made, sound) = sync_channel::<Made>(1);
        let maker = self.clone();
        let (id, speed, debug) = (utterance.id, utterance.speed, debugging());
        std::thread::spawn(move || {
            let synthesizer = match maker.engines.synthesizer() {
                Ok(synthesizer) => synthesizer,
                Err(error) => {
                    let _ = made.send(Err(error));
                    return;
                }
            };
            for (index, line) in lines.into_iter().enumerate() {
                if maker.stale(generation) {
                    return;
                }
                let spoken = match synthesizer.lock() {
                    Ok(mut synthesizer) => {
                        synthesizer.speak(&line.text, &line.voice, line.tag.as_deref(), speed)
                    }
                    Err(_) => Err("Voice is not well.".to_owned()),
                }
                .map(|spoken| joined(spoken, index, cut, seams[index]));
                if let (true, Ok(spoken)) = (debug, &spoken) {
                    eprintln!(
                        "dashi-voice: speak {id}.{index} voice={} language={} phonemes=[{}] text=[{}]",
                        line.voice, spoken.language, spoken.phonemes, line.text
                    );
                }
                let failed = spoken.is_err();
                if made
                    .send(spoken.map(|spoken| (index, line, spoken)))
                    .is_err()
                    || failed
                {
                    return;
                }
            }
        });
        let mut player = Player::new(self, utterance.id, generation);
        // The speakers open now, while the first sentence is made: opening them takes a
        // while of its own (a program starts, PipeWire links it), and the sound waited for it.
        let result = if any { player.open() } else { Ok(()) }.and_then(|()| player.play(&sound));
        let spoke = player.sounding;
        match (&result, player.speaker.take()) {
            (Ok(true), Some(speaker)) => speaker.finish(),
            (_, speaker) => drop(speaker),
        }
        if let Ok(mut queue) = self.speech.queue.lock()
            && queue.generation == generation
        {
            queue.close = None;
        }
        let (reason, error) = match result {
            Ok(true) => (Ended::Done, None),
            Ok(false) => (Ended::Stopped, None),
            Err(error) => (Ended::Failed, Some(error)),
        };
        if let Some(message) = &error {
            self.hub.emit(&Event::Error {
                message: message.clone(),
            });
        }
        self.hub.emit(&Event::Spoken {
            id: utterance.id,
            reason,
            error,
        });
        self.act(|activity| {
            if spoke {
                activity.speaking = false;
            } else {
                activity.thinking -= 1;
            }
        });
    }
}
