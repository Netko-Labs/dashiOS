//! Reading the microphone for one listen: every frame goes through the gate,
//! which keeps the speech, until the listen is stopped, cancelled, ends
//! itself on a quiet, or reaches five minutes. A held key's listen keeps
//! every frame (the gate only says whether anyone spoke), and goes on a
//! little after the key comes up, for as long as the voice does.

use std::fmt;
use std::sync::atomic::Ordering;
use std::sync::mpsc::SyncSender;

use super::Service;
use super::listen::{CANCELLED, Run, STOPPING};
use crate::audio::LISTEN_RATE;
use crate::audio::level::level;
use crate::audio::pipewire::Microphone;
use crate::engine::gate::{Gate, OFF};
use crate::engine::vad::{FRAME, FRAME_MS, SpeechDetector};
use crate::protocol::Event;

/// Frames always read after `listen.stop` (192 ms): the key is let go as the last word ends.
pub(super) const TAIL: usize = 6;
/// After those, the listen goes on while the voice does, up to this many frames in all (384 ms).
const TAIL_MOST: usize = 12;
/// Frames in a row the detector must call quiet before a stopped listen ends.
const TAIL_QUIET: usize = 2;
/// The longest listen: five minutes of frames.
const MOST: usize = 5 * 60 * LISTEN_RATE as usize / FRAME;
/// Frames between partial words (0.8 s).
const PARTIAL_EVERY: usize = 25;
/// How long a quiet ends a listen that ends by itself, unless told.
const QUIET_MS: u64 = 1200;

/// A quiet's length as asked, within what is allowed.
pub(super) fn quiet_of(asked: Option<u64>) -> u64 {
    asked.unwrap_or(QUIET_MS).clamp(300, 10_000)
}

/// Whether a stopped listen has read enough: `after` frames since the stop, the last `hush` of them quiet. Never cut
/// while the detector still hears the voice, but never wait long for it.
fn tail_ends(after: usize, hush: usize) -> bool {
    after >= TAIL_MOST || (after >= TAIL && hush >= TAIL_QUIET)
}

/// Why a listen ended, for the logs and the asker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Ended {
    /// `listen.stop`, and this many ms read after it.
    KeyUp(u64),
    /// A quiet of this many ms after speech.
    Silence(u64),
    /// Five minutes.
    Max,
    /// `listen.cancel`, or the connection went.
    Stopped,
    /// The microphone gave no more sound (closed, or deaf).
    Closed,
}

impl fmt::Display for Ended {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::KeyUp(ms) => write!(out, "key-up({ms})"),
            Self::Silence(ms) => write!(out, "silence({ms})"),
            Self::Max => out.write_str("max"),
            Self::Stopped => out.write_str("stopped"),
            Self::Closed => out.write_str("closed"),
        }
    }
}

/// Read the microphone until the listen ends; what the gate kept and why it ended, or why there is nothing.
pub(super) fn capture(
    service: &Service,
    run: &Run,
    mut microphone: Box<dyn Microphone>,
    mut detector: Box<dyn SpeechDetector>,
    partials: &SyncSender<Vec<f32>>,
    whole: bool,
) -> Result<(Gate, Ended), String> {
    let mut gate = if whole {
        Gate::whole()
    } else {
        Gate::default()
    };
    let mut frame = vec![0.0; FRAME];
    let (mut frames, mut sent) = (0, 0);
    // Frames read since the stop, and the quiet ones in a row among them.
    let (mut after, mut hush) = (0, 0);
    let mut ended = Ended::Closed;
    while microphone.read(&mut frame)? {
        if frames >= MOST {
            ended = Ended::Max;
            break;
        }
        frames += 1;
        run.frames.store(frames, Ordering::SeqCst);
        let mode = run.mode.load(Ordering::SeqCst);
        if mode == CANCELLED {
            ended = Ended::Stopped;
            break;
        }
        let probability = detector.probability(&frame)?;
        let began = gate.heard();
        gate.push(&frame, probability);
        if !began && gate.heard() && mode != STOPPING {
            service.hub.emit(&Event::Speech {});
        }
        if mode == STOPPING {
            after += 1;
            hush = if probability < OFF { hush + 1 } else { 0 };
            if tail_ends(after, hush) {
                ended = Ended::KeyUp(after as u64 * FRAME_MS);
                break;
            }
            continue;
        }
        service.hub.emit(&Event::Level {
            level: level(&frame),
        });
        let quiet = run.quiet.load(Ordering::SeqCst);
        if quiet > 0 && gate.quiet_ms() >= quiet {
            ended = Ended::Silence(gate.quiet_ms());
            break;
        }
        if frames % PARTIAL_EVERY == 0
            && gate.speech().len() > sent
            && partials.try_send(gate.speech().to_vec()).is_ok()
        {
            sent = gate.speech().len();
        }
    }
    if run.mode.load(Ordering::SeqCst) == STOPPING && ended == Ended::Closed {
        ended = Ended::KeyUp(after as u64 * FRAME_MS);
    }
    if frames == 0 && run.mode.load(Ordering::SeqCst) != CANCELLED {
        return Err("The microphone gave no sound. Check the input in Sound settings.".into());
    }
    Ok((gate, ended))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_key_up_tail_waits_for_the_voice_but_not_long() {
        // Quiet at once: the six frames, no more.
        assert!(!tail_ends(5, 5));
        assert!(tail_ends(6, 2));
        // Still speaking at the sixth: read on until two quiet frames, or twelve in all.
        assert!(!tail_ends(6, 0));
        assert!(!tail_ends(9, 1));
        assert!(tail_ends(9, 2));
        assert!(tail_ends(12, 0));
        assert_eq!(Ended::KeyUp(224).to_string(), "key-up(224)");
        assert_eq!(Ended::Silence(1824).to_string(), "silence(1824)");
    }
}
