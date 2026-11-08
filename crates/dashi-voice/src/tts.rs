//! Text to speech: Kokoro-82M v1.0 (Apache-2.0), as ONNX
//! (onnx-community/Kokoro-82M-v1.0-ONNX), 24 kHz. A voice is a style table
//! (`voices/<name>.bin`, 510 × 256 floats): the row for the utterance's
//! length is the style it is spoken in.

use std::collections::HashMap;

use ort::{session::Session, value::Tensor};

use crate::{models, phonemes};

const STYLE: usize = 256;

pub(crate) struct Kokoro {
    session: Session,
    vocab: HashMap<char, i64>,
    voices: HashMap<String, Vec<f32>>,
    paths: models::Paths,
}

impl Kokoro {
    pub(crate) fn load(paths: models::Paths) -> Result<Self, String> {
        let tokenizer = std::fs::read_to_string(paths.kokoro("tokenizer.json"))
            .map_err(|error| format!("tokenizer.json: {error}"))?;
        Ok(Self {
            session: models::session(&paths.kokoro("model.onnx"), models::threads())?,
            vocab: phonemes::parse_vocab(&tokenizer)?,
            voices: HashMap::new(),
            paths,
        })
    }

    fn voice(&mut self, name: &str) -> Result<&[f32], String> {
        if !self.voices.contains_key(name) {
            let path = self
                .paths
                .voice(name)
                .ok_or_else(|| format!("no voice called {name}"))?;
            let bytes = std::fs::read(&path).map_err(|error| format!("voice {name}: {error}"))?;
            let table = crate::audio::f32_from_le(&bytes);
            if table.len() < STYLE {
                return Err(format!("voice {name} is empty"));
            }
            self.voices.insert(name.to_string(), table);
        }
        Ok(self.voices.get(name).map(Vec::as_slice).unwrap_or_default())
    }

    /// One sentence, said in `voice` at `speed`: 24 kHz samples.
    pub(crate) fn say(
        &mut self,
        sentence: &str,
        lang: &str,
        voice: &str,
        speed: f32,
    ) -> Result<Vec<f32>, String> {
        let symbols = phonemes::phonemize(sentence, lang)?;
        let mut out = Vec::new();
        for piece in phonemes::pieces(&symbols) {
            out.extend(self.synthesize(&piece, voice, speed)?);
        }
        Ok(out)
    }

    fn synthesize(&mut self, symbols: &str, voice: &str, speed: f32) -> Result<Vec<f32>, String> {
        let ids = phonemes::tokens(symbols, &self.vocab);
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = self.voice(voice)?.len() / STYLE;
        let row = ids.len().min(rows - 1);
        let style = self.voice(voice)?[row * STYLE..(row + 1) * STYLE].to_vec();
        let mut input = Vec::with_capacity(ids.len() + 2);
        input.push(0);
        input.extend(ids);
        input.push(0);
        let fail = |error: ort::Error| format!("text to speech: {error}");
        let length = input.len();
        let input_ids = Tensor::from_array(([1usize, length], input)).map_err(fail)?;
        let style = Tensor::from_array(([1usize, STYLE], style)).map_err(fail)?;
        let speed = Tensor::from_array(([1usize], vec![speed])).map_err(fail)?;
        let outputs = self
            .session
            .run(ort::inputs!["input_ids" => input_ids, "style" => style, "speed" => speed])
            .map_err(fail)?;
        let (_, samples) = outputs["waveform"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        Ok(samples.to_vec())
    }
}
