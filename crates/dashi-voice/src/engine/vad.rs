//! Silero VAD (MIT): how likely each 32 ms of sound is speech. The model
//! keeps a small state from one frame to the next, and hears the last 64
//! samples of the frame before with each new one.

use std::path::Path;

use ort::session::Session;

use super::{runtime, tensor};
use crate::audio::LISTEN_RATE;

/// Samples in a frame at 16 kHz: 32 ms.
pub(crate) const FRAME: usize = 512;
pub(crate) const FRAME_MS: u64 = 32;
const CONTEXT: usize = 64;
const STATE: usize = 2 * 128;

/// Says how likely a frame is speech; the gate (gate.rs) decides with it. One
/// is made for each listen: it remembers the sound before.
pub(crate) trait SpeechDetector: Send {
    /// 0 to 1 for a frame of `FRAME` samples.
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String>;
}

pub(crate) struct Silero {
    session: Session,
    state: Vec<f32>,
    context: Vec<f32>,
}

impl Silero {
    pub(crate) fn open(model: &Path) -> Result<Self, String> {
        Ok(Self {
            session: runtime::session(model)?,
            state: vec![0.0; STATE],
            context: vec![0.0; CONTEXT],
        })
    }
}

impl SpeechDetector for Silero {
    fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        let mut input = self.context.clone();
        input.extend_from_slice(frame);
        input.resize(CONTEXT + FRAME, 0.0);
        self.context.copy_from_slice(&input[FRAME..]);
        let outputs = self
            .session
            .run(ort::inputs![
                "input" => tensor::floats(&[1, CONTEXT + FRAME], input)?,
                "state" => tensor::floats(&[2, 1, 128], std::mem::take(&mut self.state))?,
                "sr" => tensor::longs(&[], vec![i64::from(LISTEN_RATE)])?,
            ])
            .map_err(tensor::words)?;
        let (_, state) = tensor::output(&outputs, "stateN")?;
        let (_, probability) = tensor::output(&outputs, "output")?;
        self.state = state;
        self.state.resize(STATE, 0.0);
        Ok(probability.first().copied().unwrap_or(0.0))
    }
}
