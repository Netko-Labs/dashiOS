//! The gate: from each frame's chance of being speech, what to keep. Silence
//! before, after and between phrases is dropped but for a short pad, so the
//! speech model hears words and not a quiet room (which it would turn into
//! words of its own). It also says how long it has been quiet, for a listen
//! that ends by itself.

use std::collections::VecDeque;

use super::vad::{FRAME, FRAME_MS};

/// Speech begins at this chance, and goes on until it falls below `OFF`.
const ON: f32 = 0.5;
const OFF: f32 = 0.35;
/// Frames in a row above `ON` before it counts: a click is not a word.
const ONSET: usize = 2;
/// Frames kept before speech begins (256 ms): the first consonant is quiet.
const LEAD: usize = 8;
/// Quiet frames kept after speech (480 ms) before the gate closes.
const HANG: usize = 15;

#[derive(Default)]
pub(crate) struct Gate {
    open: bool,
    /// Frames in a row above `ON` while closed.
    loud: usize,
    /// Frames in a row below `OFF`, since speech was last heard.
    quiet: usize,
    heard: bool,
    lead: VecDeque<Vec<f32>>,
    kept: Vec<f32>,
}

impl Gate {
    /// One frame and its chance of being speech.
    pub(crate) fn push(&mut self, frame: &[f32], probability: f32) {
        if probability < OFF {
            self.quiet += 1;
        } else if probability >= ON || self.open {
            self.quiet = 0;
        }
        if self.open {
            self.kept.extend_from_slice(frame);
            if self.quiet > HANG {
                self.open = false;
                self.loud = 0;
            }
            return;
        }
        self.lead.push_back(frame.to_vec());
        self.loud = if probability >= ON { self.loud + 1 } else { 0 };
        if self.loud >= ONSET {
            self.open = true;
            self.heard = true;
            for frame in self.lead.drain(..) {
                self.kept.extend_from_slice(&frame);
            }
        } else if self.lead.len() > LEAD {
            self.lead.pop_front();
        }
    }

    /// Someone has spoken since the gate was made.
    pub(crate) fn heard(&self) -> bool {
        self.heard
    }

    /// How long it has been quiet since the last speech; 0 before any.
    pub(crate) fn quiet_ms(&self) -> u64 {
        if self.heard {
            self.quiet as u64 * FRAME_MS
        } else {
            0
        }
    }

    /// The speech so far, silence trimmed.
    pub(crate) fn speech(&self) -> &[f32] {
        &self.kept
    }
}

/// Speech cut into pieces a model can take, `longest` samples at most, each
/// cut at the quietest tenth of a second of the piece's last third.
pub(crate) fn pieces(speech: &[f32], longest: usize) -> Vec<&[f32]> {
    let window = FRAME * 3;
    let mut pieces = Vec::new();
    let mut rest = speech;
    while rest.len() > longest && longest > window * 2 {
        let from = longest - longest / 3;
        let mut cut = longest;
        let mut least = f32::MAX;
        let mut at = from;
        while at + window <= longest {
            let energy: f32 = rest[at..at + window].iter().map(|s| s * s).sum();
            if energy < least {
                least = energy;
                cut = at + window / 2;
            }
            at += FRAME;
        }
        pieces.push(&rest[..cut]);
        rest = &rest[cut..];
    }
    if !rest.is_empty() {
        pieces.push(rest);
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(gate: &mut Gate, frames: usize, probability: f32, value: f32) {
        for _ in 0..frames {
            gate.push(&[value; FRAME], probability);
        }
    }

    #[test]
    fn silence_is_dropped_and_speech_keeps_a_pad() {
        let mut gate = Gate::default();
        feed(&mut gate, 100, 0.01, 0.0);
        assert!(!gate.heard());
        assert!(gate.speech().is_empty());
        assert_eq!(gate.quiet_ms(), 0);
        feed(&mut gate, 20, 0.95, 0.5);
        assert!(gate.heard());
        // The 20 frames of speech, and the lead before them (which holds the two onset frames).
        assert_eq!(gate.speech().len(), (20 + LEAD - 1) * FRAME);
        feed(&mut gate, 100, 0.01, 0.0);
        // The hang after, and no more however long the silence.
        assert_eq!(gate.speech().len(), (20 + LEAD - 1 + HANG + 1) * FRAME);
        assert_eq!(gate.quiet_ms(), 100 * FRAME_MS);
    }

    #[test]
    fn a_click_does_not_open_the_gate() {
        let mut gate = Gate::default();
        feed(&mut gate, 10, 0.0, 0.0);
        feed(&mut gate, 1, 0.99, 1.0);
        feed(&mut gate, 10, 0.0, 0.0);
        assert!(!gate.heard());
        assert!(gate.speech().is_empty());
    }

    #[test]
    fn a_dip_between_words_keeps_the_gate_open() {
        let mut gate = Gate::default();
        feed(&mut gate, 5, 0.9, 0.5);
        // Between ON and OFF: still speech, and not quiet.
        feed(&mut gate, 30, 0.4, 0.2);
        assert_eq!(gate.quiet_ms(), 0);
        feed(&mut gate, 5, 0.9, 0.5);
        assert_eq!(gate.speech().len(), 40 * FRAME);
    }

    #[test]
    fn long_speech_is_cut_where_it_is_quietest() {
        let mut speech = vec![0.5; 100 * FRAME];
        // A quiet stretch in the last third of the first piece.
        for sample in &mut speech[50 * FRAME..54 * FRAME] {
            *sample = 0.0;
        }
        let pieces = pieces(&speech, 60 * FRAME);
        assert_eq!(pieces.len(), 2);
        let cut = pieces[0].len();
        assert!((50 * FRAME..54 * FRAME).contains(&cut), "{cut}");
        assert_eq!(pieces[0].len() + pieces[1].len(), speech.len());
        // Short speech is one piece; none is none.
        assert_eq!(super::pieces(&speech[..FRAME], 60 * FRAME).len(), 1);
        assert!(super::pieces(&[], 60 * FRAME).is_empty());
    }
}
