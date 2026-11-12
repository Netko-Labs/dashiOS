//! Speaking: one thread says what is asked, a sentence at a time. Each
//! sentence is made into sound while the one before plays; the sound is
//! written a little ahead of when it plays, so stopping is at once, and each
//! sentence's event is sent as its first sound plays, for captions in step.

use std::collections::VecDeque;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

use super::player::Player;
use super::{Service, voices};
use crate::audio::pipewire::Closer;
use crate::engine::Spoken;
use crate::protocol::{Ended, Event, Speak};

/// The most text at once.
const MOST_TEXT: usize = 20_000;

struct Utterance {
    id: u64,
    text: String,
    voice: String,
    speed: f32,
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

/// A sentence, made: its place, its words, its sound.
pub(super) type Made = Result<(usize, String, Spoken), String>;

/// The hush kept before the first sound of an utterance, and at each side of
/// the join of a sentence said in two pieces (a comma's pause in all).
const LEAD_MS: u64 = 30;
const JOIN_MS: u64 = 120;

/// A piece without the hush that only delays: the model starts each piece
/// with a third of a second of it, which the first sound of an utterance
/// waited through, and ends each with half a second, which would make a
/// sentence said in two pieces stop for most of a second at its comma.
fn unhushed(mut spoken: Spoken, index: usize, cut: bool) -> Spoken {
    if index == 0 || (cut && index == 1) {
        spoken.trim_start(LEAD_MS);
    }
    if cut && index == 0 {
        spoken.trim_end(JOIN_MS);
    }
    spoken
}

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
        if params.text.len() > MOST_TEXT {
            return Err("That is too much to say at once.".into());
        }
        let voice = voices::choose(params.voice.as_deref(), params.language.as_deref())?;
        if let Some(why) = self.engines.mute_in(&voice) {
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
            text: params.text,
            voice,
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
        let (sentences, cut) = crate::text::pieces_cut(&utterance.text);
        let any = !sentences.is_empty();
        let (made, sound) = sync_channel::<Made>(1);
        let maker = self.clone();
        let (voice, speed) = (utterance.voice.clone(), utterance.speed);
        std::thread::spawn(move || {
            let synthesizer = match maker.engines.synthesizer() {
                Ok(synthesizer) => synthesizer,
                Err(error) => {
                    let _ = made.send(Err(error));
                    return;
                }
            };
            for (index, sentence) in sentences.into_iter().enumerate() {
                if maker.stale(generation) {
                    return;
                }
                let spoken = match synthesizer.lock() {
                    Ok(mut synthesizer) => synthesizer.speak(&sentence, &voice, speed),
                    Err(_) => Err("Voice is not well.".to_owned()),
                }
                .map(|spoken| unhushed(spoken, index, cut));
                let failed = spoken.is_err();
                if made
                    .send(spoken.map(|spoken| (index, sentence, spoken)))
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
