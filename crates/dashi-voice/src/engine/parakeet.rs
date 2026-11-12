//! Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0; the ONNX files are Ilya
//! Stupakov's export): speech to text in 25 European languages. Three
//! models: sound to features, the encoder, and the decoder with its joiner
//! (tdt.rs walks it).

use std::path::Path;

use ort::session::Session;

use super::tdt::{self, Predictor};
use super::{Recognizer, runtime, tensor};

/// The languages Parakeet v3 was trained on (ISO 639-1).
pub(crate) const LANGUAGES: [&str; 25] = [
    "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it", "lt", "lv", "mt",
    "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
];

/// The most sound at once: a minute. The encoder's work grows with the square of the length.
const LONGEST: usize = 60 * crate::audio::LISTEN_RATE as usize;

/// The decoder's memory: two layers of 640.
const MEMORY: usize = 2 * 640;

pub(crate) struct Parakeet {
    features: Session,
    encoder: Session,
    decoder: Session,
    vocabulary: Vec<String>,
}

impl Parakeet {
    pub(crate) fn open(folder: &Path) -> Result<Self, String> {
        let vocabulary = std::fs::read_to_string(folder.join("vocab.txt"))
            .map_err(|error| format!("the speech model's vocabulary: {error}"))?;
        Ok(Self {
            features: runtime::session(&folder.join("nemo128.onnx"))?,
            encoder: runtime::session(&folder.join("encoder-model.int8.onnx"))?,
            decoder: runtime::session(&folder.join("decoder_joint-model.int8.onnx"))?,
            vocabulary: tdt::vocabulary(&vocabulary)?,
        })
    }

    /// The encoder's frames for this sound: (how many, how wide, the numbers by width then frame).
    fn encode(&mut self, samples: &[f32]) -> Result<(usize, usize, Vec<f32>), String> {
        let outputs = self
            .features
            .run(ort::inputs![
                "waveforms" => tensor::floats(&[1, samples.len()], samples.to_vec())?,
                "waveforms_lens" => tensor::longs(&[1], vec![samples.len() as i64])?,
            ])
            .map_err(tensor::words)?;
        let (shape, features) = tensor::output(&outputs, "features")?;
        let frames = shape.get(2).copied().unwrap_or(0);
        drop(outputs);
        let outputs = self
            .encoder
            .run(ort::inputs![
                "audio_signal" => tensor::floats(&shape, features)?,
                "length" => tensor::longs(&[1], vec![frames as i64])?,
            ])
            .map_err(tensor::words)?;
        let (shape, encoded) = tensor::output(&outputs, "outputs")?;
        match shape.as_slice() {
            [1, width, frames] => Ok((*frames, *width, encoded)),
            _ => Err("the speech model's answer is the wrong shape".into()),
        }
    }
}

/// The decoder walking one sound's encoder frames.
struct Walk<'a> {
    decoder: &'a mut Session,
    frames: usize,
    width: usize,
    encoded: Vec<f32>,
}

impl Predictor for Walk<'_> {
    type Memory = (Vec<f32>, Vec<f32>);

    fn start(&self) -> Self::Memory {
        (vec![0.0; MEMORY], vec![0.0; MEMORY])
    }

    fn step(
        &mut self,
        frame: usize,
        last: usize,
        memory: &Self::Memory,
    ) -> Result<(Vec<f32>, Self::Memory), String> {
        let column: Vec<f32> = (0..self.width)
            .map(|row| self.encoded[row * self.frames + frame])
            .collect();
        let outputs = self
            .decoder
            .run(ort::inputs![
                "encoder_outputs" => tensor::floats(&[1, self.width, 1], column)?,
                "targets" => tensor::ints(&[1, 1], vec![last as i32])?,
                "target_length" => tensor::ints(&[1], vec![1])?,
                "input_states_1" => tensor::floats(&[2, 1, 640], memory.0.clone())?,
                "input_states_2" => tensor::floats(&[2, 1, 640], memory.1.clone())?,
            ])
            .map_err(tensor::words)?;
        let (_, scores) = tensor::output(&outputs, "outputs")?;
        let (_, first) = tensor::output(&outputs, "output_states_1")?;
        let (_, second) = tensor::output(&outputs, "output_states_2")?;
        Ok((scores, (first, second)))
    }
}

impl Recognizer for Parakeet {
    fn transcribe(&mut self, samples: &[f32], _language: Option<&str>) -> Result<String, String> {
        let (frames, width, encoded) = self.encode(samples)?;
        let mut walk = Walk {
            decoder: &mut self.decoder,
            frames,
            width,
            encoded,
        };
        let named = tdt::decode(&mut walk, frames, self.vocabulary.len())?;
        Ok(tdt::text(&named, &self.vocabulary))
    }

    fn longest(&self) -> usize {
        LONGEST
    }
}
