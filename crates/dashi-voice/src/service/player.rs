//! Playing one utterance: its sentences' sound is written to the speakers a
//! little ahead of when it plays, and each sentence's event is sent as its
//! first sound plays.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::Duration;

use super::Service;
use super::speak::Made;
use crate::audio::SPEAK_RATE;
use crate::audio::pipewire::Speaker;
use crate::protocol::{Event, WordTime};

/// Sound is written this far ahead of when it plays.
const LEAD: Duration = Duration::from_millis(150);
/// Samples written at a time: 20 ms.
const CHUNK: usize = SPEAK_RATE as usize / 50;

fn samples_time(samples: usize) -> Duration {
    Duration::from_micros(samples as u64 * 1_000_000 / u64::from(SPEAK_RATE))
}

/// Plays one utterance's sentences as they are made.
pub(super) struct Player<'a> {
    pub(super) service: &'a Arc<Service>,
    pub(super) id: u64,
    pub(super) generation: u64,
    pub(super) speaker: Option<Box<dyn Speaker>>,
    /// When the first sample played, on the service's clock.
    start: Option<Duration>,
    /// Samples written so far.
    written: usize,
    /// Events to send, each when its sample plays.
    due: VecDeque<(usize, Event)>,
}

impl<'a> Player<'a> {
    pub(super) fn new(service: &'a Arc<Service>, id: u64, generation: u64) -> Self {
        Self {
            service,
            id,
            generation,
            speaker: None,
            start: None,
            written: 0,
            due: VecDeque::new(),
        }
    }
}

impl Player<'_> {
    /// True when everything was said; false when stopped.
    pub(super) fn play(&mut self, sound: &Receiver<Made>) -> Result<bool, String> {
        for made in sound {
            let (index, text, spoken) = made?;
            if self.service.stale(self.generation) {
                return Ok(false);
            }
            self.open()?;
            let ms = samples_time(spoken.samples.len()).as_millis() as u64;
            let words = spoken.words.iter().map(WordTime::from).collect();
            self.due.push_back((
                self.written,
                Event::Sentence {
                    id: self.id,
                    index,
                    text,
                    ms,
                    words,
                },
            ));
            for chunk in spoken.samples.chunks(CHUNK) {
                self.pace();
                if self.service.stale(self.generation) {
                    return Ok(false);
                }
                if let Some(speaker) = self.speaker.as_mut() {
                    speaker.write(chunk)?;
                }
                self.written += chunk.len();
            }
        }
        // All is written; the last of it plays a moment from now.
        while self.start.is_some() && self.played() < self.written {
            if self.service.stale(self.generation) {
                return Ok(false);
            }
            self.service.clock.sleep(samples_time(CHUNK));
            self.tell();
        }
        self.tell();
        Ok(true)
    }

    /// Open the speakers for the first sound, and let a stop close them.
    fn open(&mut self) -> Result<(), String> {
        if self.speaker.is_some() {
            return Ok(());
        }
        let speaker = self.service.sound.speaker()?;
        if !self.service.closes(self.generation, speaker.closer()) {
            return Ok(());
        }
        self.speaker = Some(speaker);
        self.service.act(|activity| {
            activity.thinking -= 1;
            activity.speaking = true;
        });
        Ok(())
    }

    /// Samples that have played by now.
    fn played(&self) -> usize {
        let Some(start) = self.start else {
            return 0;
        };
        let elapsed = self.service.clock.now().saturating_sub(start);
        (elapsed.as_micros() as u64 * u64::from(SPEAK_RATE) / 1_000_000) as usize
    }

    /// Wait until the next chunk is due to be written: `LEAD` before it plays.
    fn pace(&mut self) {
        let now = self.service.clock.now();
        let start = *self.start.get_or_insert(now);
        let plays = start + samples_time(self.written);
        if now > plays {
            // The sound ran dry (a sentence took long to make): what comes now plays now.
            self.start = Some(start + (now - plays));
        } else if plays - now > LEAD {
            self.service.clock.sleep(plays - now - LEAD);
        }
        self.tell();
    }

    /// Send the events whose sound has begun.
    fn tell(&mut self) {
        let played = self.played();
        while self
            .due
            .front()
            .is_some_and(|(sample, _)| *sample <= played)
        {
            if let Some((_, event)) = self.due.pop_front() {
                self.service.hub.emit(&event);
            }
        }
    }
}
