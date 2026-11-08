//! Where speech starts and ends, from Silero's speech probability per frame.
//!
//! Pure: it sees one probability per 32 ms frame (512 samples at 16 kHz) and
//! says when speech began, when it ended, or that none came. Hysteresis keeps
//! a word's quiet tail from ending it: speech starts above `start` held for
//! `min_speech` frames, and ends after `end_silence` frames below `end`.

/// Samples in one frame at 16 kHz (Silero v5's window).
pub(crate) const FRAME: usize = 512;
/// One frame, in milliseconds.
pub(crate) const FRAME_MS: u32 = 32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Tuning {
    /// A frame at or above this is speech.
    pub start: f32,
    /// Below this (once speaking) is silence.
    pub end: f32,
    /// Frames of speech in a row before it counts (a click or a breath doesn't).
    pub min_speech: u32,
    /// Frames of silence that end a turn; `None` while a key is held (the key ends it).
    pub end_silence: Option<u32>,
    /// Frames to wait for speech before giving up; `None` waits for the key.
    pub max_wait: Option<u32>,
    /// Frames of speech at most; the turn ends there.
    pub max_speech: u32,
}

impl Tuning {
    /// A held key: the key decides when it ends.
    pub(crate) fn hold() -> Self {
        Self {
            start: 0.5,
            end: 0.35,
            min_speech: 3,
            end_silence: None,
            max_wait: None,
            max_speech: ms_to_frames(120_000),
        }
    }

    /// An answer Dashi waits for: speech within `wait_ms`, ended by `silence_ms` of quiet.
    pub(crate) fn turn(wait_ms: u32, silence_ms: u32) -> Self {
        Self {
            end_silence: Some(ms_to_frames(silence_ms)),
            max_wait: Some(ms_to_frames(wait_ms)),
            max_speech: ms_to_frames(60_000),
            ..Self::hold()
        }
    }

    /// Someone talking over Dashi: a longer run of speech, so a cough doesn't stop it.
    pub(crate) fn barge_in() -> Self {
        Self {
            start: 0.7,
            min_speech: ms_to_frames(250),
            ..Self::hold()
        }
    }
}

pub(crate) const fn ms_to_frames(ms: u32) -> u32 {
    ms.div_ceil(FRAME_MS)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    /// Speech began at this frame (the first of its run).
    Started { at: u32 },
    /// The turn is over: speech from `from` up to (not including) `to`.
    Ended { from: u32, to: u32 },
    /// No speech came in time.
    NoSpeech,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Waiting { run: u32 },
    Speaking { from: u32, quiet: u32 },
    Done,
}

#[derive(Debug)]
pub(crate) struct Segmenter {
    tuning: Tuning,
    state: State,
    frame: u32,
    /// The last frame that was speech, for trimming a held key's tail.
    last_speech: u32,
}

impl Segmenter {
    pub(crate) fn new(tuning: Tuning) -> Self {
        Self {
            tuning,
            state: State::Waiting { run: 0 },
            frame: 0,
            last_speech: 0,
        }
    }

    /// Frames seen so far.
    pub(crate) fn frames(&self) -> u32 {
        self.frame
    }

    #[cfg(test)]
    pub(crate) fn is_done(&self) -> bool {
        self.state == State::Done
    }

    /// The next frame's speech probability.
    pub(crate) fn push(&mut self, probability: f32) -> Option<Event> {
        let frame = self.frame;
        self.frame += 1;
        let tuning = self.tuning;
        match self.state {
            State::Done => None,
            State::Waiting { run } => {
                let run = if probability >= tuning.start {
                    run + 1
                } else {
                    0
                };
                if run >= tuning.min_speech.max(1) {
                    let from = frame + 1 - run;
                    self.state = State::Speaking { from, quiet: 0 };
                    self.last_speech = frame;
                    return Some(Event::Started { at: from });
                }
                self.state = State::Waiting { run };
                if tuning.max_wait.is_some_and(|wait| self.frame >= wait) && run == 0 {
                    self.state = State::Done;
                    return Some(Event::NoSpeech);
                }
                None
            }
            State::Speaking { from, quiet } => {
                let quiet = if probability < tuning.end {
                    quiet + 1
                } else {
                    0
                };
                if quiet == 0 {
                    self.last_speech = frame;
                }
                let too_long = self.frame - from >= tuning.max_speech;
                let ended = tuning.end_silence.is_some_and(|silence| quiet >= silence);
                if ended || too_long {
                    self.state = State::Done;
                    return Some(Event::Ended {
                        from,
                        to: self.last_speech + 1,
                    });
                }
                self.state = State::Speaking { from, quiet };
                None
            }
        }
    }

    /// The key was let go: the speech so far, if any began.
    pub(crate) fn finish(&mut self) -> Event {
        let event = match self.state {
            State::Speaking { from, .. } => Event::Ended {
                from,
                to: self.last_speech + 1,
            },
            _ => Event::NoSpeech,
        };
        self.state = State::Done;
        event
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(segmenter: &mut Segmenter, probabilities: &[f32]) -> Vec<(u32, Event)> {
        let mut events = Vec::new();
        for &probability in probabilities {
            let frame = segmenter.frames();
            if let Some(event) = segmenter.push(probability) {
                events.push((frame, event));
            }
        }
        events
    }

    #[test]
    fn speech_starts_after_a_run_and_ends_on_silence() {
        let mut segmenter = Segmenter::new(Tuning::turn(5_000, 32 * 4));
        let mut frames = vec![0.1; 5];
        frames.extend([0.9; 10]);
        frames.extend([0.1; 6]);
        let events = feed(&mut segmenter, &frames);
        assert_eq!(events[0], (7, Event::Started { at: 5 }));
        assert_eq!(events[1], (18, Event::Ended { from: 5, to: 15 }));
        assert!(segmenter.is_done());
        assert_eq!(segmenter.push(0.9), None);
    }

    #[test]
    fn a_click_is_not_speech() {
        let mut segmenter = Segmenter::new(Tuning::turn(5_000, 128));
        let events = feed(&mut segmenter, &[0.1, 0.9, 0.9, 0.1, 0.9, 0.1]);
        assert!(events.is_empty());
    }

    #[test]
    fn hysteresis_keeps_a_quiet_tail() {
        // Between end (0.35) and start (0.5) is neither: it keeps speaking going.
        let mut segmenter = Segmenter::new(Tuning::turn(5_000, 64));
        let mut frames = vec![0.9; 4];
        frames.extend([0.4; 20]);
        frames.extend([0.1; 2]);
        let events = feed(&mut segmenter, &frames);
        assert_eq!(events.last(), Some(&(25, Event::Ended { from: 0, to: 24 })));
    }

    #[test]
    fn nothing_said_in_time() {
        let mut segmenter = Segmenter::new(Tuning::turn(32 * 3, 300));
        let events = feed(&mut segmenter, &[0.1, 0.2, 0.1, 0.9]);
        assert_eq!(events, vec![(2, Event::NoSpeech)]);
    }

    #[test]
    fn waiting_out_while_speech_begins_still_listens() {
        let mut segmenter = Segmenter::new(Tuning::turn(32 * 3, 300));
        let events = feed(&mut segmenter, &[0.1, 0.1, 0.9, 0.9, 0.9]);
        assert_eq!(events, vec![(4, Event::Started { at: 2 })]);
    }

    #[test]
    fn a_held_key_ends_it_not_silence() {
        let mut segmenter = Segmenter::new(Tuning::hold());
        let mut frames = vec![0.9; 5];
        frames.extend([0.0; 200]);
        let events = feed(&mut segmenter, &frames);
        assert_eq!(events, vec![(2, Event::Started { at: 0 })]);
        assert_eq!(segmenter.finish(), Event::Ended { from: 0, to: 5 });
    }

    #[test]
    fn a_held_key_with_nothing_said() {
        let mut segmenter = Segmenter::new(Tuning::hold());
        feed(&mut segmenter, &[0.1; 50]);
        assert_eq!(segmenter.finish(), Event::NoSpeech);
    }

    #[test]
    fn a_long_turn_is_cut() {
        let tuning = Tuning {
            max_speech: 10,
            ..Tuning::hold()
        };
        let mut segmenter = Segmenter::new(tuning);
        let events = feed(&mut segmenter, &[0.9; 12]);
        assert_eq!(events.last(), Some(&(9, Event::Ended { from: 0, to: 10 })));
    }

    #[test]
    fn barge_in_needs_a_quarter_second() {
        let mut segmenter = Segmenter::new(Tuning::barge_in());
        assert_eq!(Tuning::barge_in().min_speech, 8);
        let events = feed(&mut segmenter, &[0.95; 7]);
        assert!(events.is_empty());
        assert_eq!(segmenter.push(0.95), Some(Event::Started { at: 0 }));
    }
}
