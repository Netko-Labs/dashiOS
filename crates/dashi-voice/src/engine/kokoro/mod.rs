//! Kokoro 82M (hexgrad, Apache-2.0; the ONNX file with token lengths is
//! onnx-community's): text to speech at 24 kHz, with each word's time.

mod phonemes;
mod plan;
mod timing;
mod vocab;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use ort::session::Session;

use phonemes::{Espeak, Phonemizer};
pub(crate) use phonemes::{LANGUAGES, of_voice};

use super::{Spoken, Synthesizer, runtime, tensor};
use crate::audio::SPEAK_RATE;

/// A voice file: a style of 256 numbers for each length of sentence, 510 lengths.
const STYLE: usize = 256;

pub(crate) struct Kokoro {
    session: Session,
    voices: PathBuf,
    styles: HashMap<String, Vec<f32>>,
    phonemizer: Box<dyn Phonemizer>,
}

/// A voice's name as its file is named: letters, digits and "_", nothing that is a path.
pub(crate) fn is_voice_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 32
        && name.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
        })
}

impl Kokoro {
    /// `model` is the ONNX file; `voices` the folder of `<voice>.bin`.
    pub(crate) fn open(model: &Path, voices: &Path) -> Result<Self, String> {
        Ok(Self {
            session: runtime::session(model)?,
            voices: voices.to_owned(),
            styles: HashMap::new(),
            phonemizer: Box::new(Espeak),
        })
    }

    /// The voice's style for a sentence of this many tokens.
    fn style(&mut self, voice: &str, tokens: usize) -> Result<Vec<f32>, String> {
        if !self.styles.contains_key(voice) {
            if !is_voice_name(voice) {
                return Err(format!("there is no voice named {voice}"));
            }
            let bytes = std::fs::read(self.voices.join(format!("{voice}.bin")))
                .map_err(|_| format!("the voice {voice} is not installed"))?;
            let (fours, _) = bytes.as_chunks::<4>();
            let numbers: Vec<f32> = fours.iter().map(|four| f32::from_le_bytes(*four)).collect();
            if numbers.len() < STYLE || !numbers.len().is_multiple_of(STYLE) {
                return Err(format!("the voice {voice} is damaged"));
            }
            self.styles.insert(voice.to_owned(), numbers);
        }
        let numbers = &self.styles[voice];
        let row = tokens.min(numbers.len() / STYLE - 1);
        Ok(numbers[row * STYLE..(row + 1) * STYLE].to_vec())
    }

    /// One run of the model: the sound, and each token's length.
    fn run(
        &mut self,
        tokens: &[i64],
        style: Vec<f32>,
        speed: f32,
    ) -> Result<(Vec<f32>, Vec<f32>), String> {
        let mut ids = Vec::with_capacity(tokens.len() + 2);
        ids.push(vocab::PAD);
        ids.extend_from_slice(tokens);
        ids.push(vocab::PAD);
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => tensor::longs(&[1, ids.len()], ids)?,
                "style" => tensor::floats(&[1, STYLE], style)?,
                "speed" => tensor::floats(&[1], vec![speed])?,
            ])
            .map_err(tensor::words)?;
        let (_, sound) = tensor::output(&outputs, "waveform")?;
        // A model that lost its footing gives numbers that are not numbers: an error, never silence.
        if sound.iter().any(|sample| !sample.is_finite()) {
            return Err("Voice could not say that.".into());
        }
        let (_, lengths) = tensor::output(&outputs, "durations")?;
        Ok((sound, lengths))
    }
}

impl Synthesizer for Kokoro {
    fn speak(&mut self, sentence: &str, voice: &str, speed: f32) -> Result<Spoken, String> {
        let language = of_voice(voice).ok_or_else(|| format!("there is no voice named {voice}"))?;
        let parts = plan::plan(sentence, language, self.phonemizer.as_mut())?;
        let mut spoken = Spoken::default();
        for part in parts {
            let style = self.style(voice, part.tokens.len())?;
            let (sound, lengths) = self.run(&part.tokens, style, speed.clamp(0.5, 2.0))?;
            let before_ms = spoken.samples.len() as f64 * 1000.0 / f64::from(SPEAK_RATE);
            let sound_ms = sound.len() as f64 * 1000.0 / f64::from(SPEAK_RATE);
            for mut word in timing::words(&part, &lengths, sound_ms) {
                word.start_ms += before_ms.round() as u64;
                word.end_ms += before_ms.round() as u64;
                spoken.words.push(word);
            }
            spoken.samples.extend(sound);
        }
        Ok(spoken)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_voice_name_is_never_a_path() {
        assert!(is_voice_name("af_heart"));
        assert!(!is_voice_name("../af_heart"));
        assert!(!is_voice_name("af/heart"));
        assert!(!is_voice_name("AF"));
        assert!(!is_voice_name(""));
    }
}
