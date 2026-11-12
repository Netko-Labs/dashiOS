//! Reading the microphone for one listen: every frame goes through the gate,
//! which keeps the speech, until the listen is stopped, cancelled, ends
//! itself on a quiet, or reaches five minutes.

use std::sync::atomic::Ordering;
use std::sync::mpsc::SyncSender;

use super::Service;
use super::listen::{CANCELLED, Run, STOPPING};
use crate::audio::LISTEN_RATE;
use crate::audio::level::level;
use crate::audio::pipewire::Microphone;
use crate::engine::gate::Gate;
use crate::engine::vad::{FRAME, SpeechDetector};
use crate::protocol::Event;

/// Frames still heard after `listen.stop` (128 ms): the key is let go as the last word ends.
pub(super) const TAIL: usize = 4;
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

/// Read the microphone until the listen ends; what the gate kept, or why there is nothing.
pub(super) fn capture(
    service: &Service,
    run: &Run,
    mut microphone: Box<dyn Microphone>,
    mut detector: Box<dyn SpeechDetector>,
    partials: &SyncSender<Vec<f32>>,
) -> Result<Gate, String> {
    let mut gate = Gate::default();
    let mut frame = vec![0.0; FRAME];
    let (mut frames, mut tail, mut sent) = (0, TAIL, 0);
    while frames < MOST && microphone.read(&mut frame)? {
        frames += 1;
        run.frames.store(frames, Ordering::SeqCst);
        let mode = run.mode.load(Ordering::SeqCst);
        if mode == CANCELLED {
            break;
        }
        gate.push(&frame, detector.probability(&frame)?);
        if mode == STOPPING {
            tail -= 1;
            if tail == 0 {
                break;
            }
            continue;
        }
        service.hub.emit(&Event::Level {
            level: level(&frame),
        });
        let quiet = run.quiet.load(Ordering::SeqCst);
        if quiet > 0 && gate.quiet_ms() >= quiet {
            break;
        }
        if frames % PARTIAL_EVERY == 0
            && gate.speech().len() > sent
            && partials.try_send(gate.speech().to_vec()).is_ok()
        {
            sent = gate.speech().len();
        }
    }
    if frames == 0 && run.mode.load(Ordering::SeqCst) != CANCELLED {
        return Err("The microphone gave no sound. Check the input in Sound settings.".into());
    }
    Ok(gate)
}
