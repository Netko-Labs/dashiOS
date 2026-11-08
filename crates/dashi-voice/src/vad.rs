//! Silero VAD v5 (MIT): the chance that a 32 ms frame is speech.

use ort::{session::Session, value::Tensor};

use crate::{models, segmenter::FRAME};

/// Silero v5 reads each window with the 64 samples before it.
const CONTEXT: usize = 64;

pub(crate) struct Vad {
    session: Session,
    state: Vec<f32>,
    context: Vec<f32>,
}

impl Vad {
    pub(crate) fn load(paths: &models::Paths) -> Result<Self, String> {
        Ok(Self {
            session: models::session(&paths.silero(), 1)?,
            state: vec![0.0; 2 * 128],
            context: vec![0.0; CONTEXT],
        })
    }

    /// Start over (a new turn).
    pub(crate) fn reset(&mut self) {
        self.state.iter_mut().for_each(|value| *value = 0.0);
        self.context.iter_mut().for_each(|value| *value = 0.0);
    }

    /// One frame of `FRAME` samples at 16 kHz.
    pub(crate) fn probability(&mut self, frame: &[f32]) -> Result<f32, String> {
        debug_assert_eq!(frame.len(), FRAME);
        let mut input = Vec::with_capacity(CONTEXT + FRAME);
        input.extend_from_slice(&self.context);
        input.extend_from_slice(frame);
        self.context.copy_from_slice(&frame[FRAME - CONTEXT..]);
        let fail = |error: ort::Error| format!("VAD: {error}");
        let input = Tensor::from_array(([1usize, CONTEXT + FRAME], input)).map_err(fail)?;
        let state = Tensor::from_array(([2usize, 1, 128], self.state.clone())).map_err(fail)?;
        let rate = Tensor::from_array(([1usize], vec![16_000i64])).map_err(fail)?;
        let outputs = self
            .session
            .run(ort::inputs!["input" => input, "state" => state, "sr" => rate])
            .map_err(fail)?;
        let (_, probability) = outputs["output"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        let probability = probability.first().copied().unwrap_or(0.0);
        let (_, state) = outputs["stateN"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        self.state.copy_from_slice(state);
        Ok(probability)
    }
}
