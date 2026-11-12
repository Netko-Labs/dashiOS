//! Whisper large-v3-turbo (OpenAI, MIT; the ONNX files are sherpa-onnx's
//! export): speech to text in the languages Parakeet lacks. The encoder
//! hears up to 30 s at once; the decoder then names one token at a time,
//! keeping what it has worked out so far in a cache.

mod mel;
mod tokens;

use std::path::Path;

use ort::session::Session;

use self::tokens::Facts;
use super::tensor::{self, argmax};
use super::{Recognizer, runtime};
use crate::audio::LISTEN_RATE;

/// Silence added after the sound, so the model hears that it ended: with less
/// than two seconds it says the last words twice.
const TAIL: usize = 2 * LISTEN_RATE as usize;
/// The most the encoder takes: 30 s.
const LONGEST: usize = 30 * LISTEN_RATE as usize;

pub(crate) struct Whisper {
    encoder: Session,
    decoder: Session,
    facts: Facts,
    filters: Vec<f32>,
    vocabulary: Vec<Vec<u8>>,
}

/// What the encoder heard, as the decoder takes it.
struct Heard {
    keys: (Vec<usize>, Vec<f32>),
    values: (Vec<usize>, Vec<f32>),
}

/// The decoder's cache: what it worked out for the tokens so far.
struct Cache {
    keys: Vec<f32>,
    values: Vec<f32>,
    offset: i64,
}

impl Whisper {
    pub(crate) fn open(folder: &Path) -> Result<Self, String> {
        let encoder = runtime::session(&folder.join("turbo-encoder.int8.onnx"))?;
        let facts = tokens::facts(&encoder)?;
        let file = std::fs::read_to_string(folder.join("turbo-tokens.txt"))
            .map_err(|error| format!("the Whisper model's vocabulary: {error}"))?;
        Ok(Self {
            decoder: runtime::session(&folder.join("turbo-decoder.int8.onnx"))?,
            filters: mel::filters(facts.bands),
            vocabulary: tokens::vocabulary(&file)?,
            encoder,
            facts,
        })
    }

    fn encode(&mut self, samples: &[f32]) -> Result<Heard, String> {
        let mut padded = samples[..samples.len().min(LONGEST)].to_vec();
        padded.resize((padded.len() + TAIL).min(LONGEST), 0.0);
        let (mel, frames) = mel::log_mel(&padded, &self.filters, self.facts.bands);
        let outputs = self
            .encoder
            .run(ort::inputs!["mel" => tensor::floats(&[1, self.facts.bands, frames], mel)?])
            .map_err(tensor::words)?;
        Ok(Heard {
            keys: tensor::output(&outputs, "n_layer_cross_k")?,
            values: tensor::output(&outputs, "n_layer_cross_v")?,
        })
    }

    fn cache(&self) -> Cache {
        let size = self.facts.layers * self.facts.context * self.facts.state;
        Cache {
            keys: vec![0.0; size],
            values: vec![0.0; size],
            offset: 0,
        }
    }

    /// The scores for what comes after these tokens.
    fn step(
        &mut self,
        tokens: &[i64],
        cache: &mut Cache,
        heard: &Heard,
    ) -> Result<Vec<f32>, String> {
        let shape = [self.facts.layers, 1, self.facts.context, self.facts.state];
        let outputs = self
            .decoder
            .run(ort::inputs![
                "tokens" => tensor::longs(&[1, tokens.len()], tokens.to_vec())?,
                "in_n_layer_self_k_cache" => tensor::floats(&shape, std::mem::take(&mut cache.keys))?,
                "in_n_layer_self_v_cache" => tensor::floats(&shape, std::mem::take(&mut cache.values))?,
                "n_layer_cross_k" => tensor::floats(&heard.keys.0, heard.keys.1.clone())?,
                "n_layer_cross_v" => tensor::floats(&heard.values.0, heard.values.1.clone())?,
                "offset" => tensor::longs(&[1], vec![cache.offset])?,
            ])
            .map_err(tensor::words)?;
        let (shape, logits) = tensor::output(&outputs, "logits")?;
        cache.keys = tensor::output(&outputs, "out_n_layer_self_k_cache")?.1;
        cache.values = tensor::output(&outputs, "out_n_layer_self_v_cache")?.1;
        cache.offset += tokens.len() as i64;
        let width = shape.last().copied().unwrap_or(0);
        if width == 0 || logits.len() < width {
            return Err("the Whisper model's answer is the wrong shape".into());
        }
        Ok(logits[logits.len() - width..].to_vec())
    }

    /// The language's token: the one asked for if Whisper knows it, else the one it hears.
    fn language(&mut self, asked: Option<&str>, heard: &Heard) -> Result<i64, String> {
        let known = asked.and_then(|code| {
            self.facts
                .languages
                .iter()
                .find(|(known, _)| known == code)
                .map(|(_, token)| *token)
        });
        if let Some(token) = known {
            return Ok(token);
        }
        let mut cache = self.cache();
        let scores = self.step(&[self.facts.sot], &mut cache, heard)?;
        self.facts
            .languages
            .iter()
            .map(|(_, token)| *token)
            .max_by(|a, b| scores[*a as usize].total_cmp(&scores[*b as usize]))
            .ok_or_else(|| "the Whisper model names no languages".to_owned())
    }

    /// Tokens that are never the answer when writing down what was said.
    fn suppress(&self, scores: &mut [f32], first: bool) {
        let facts = &self.facts;
        let mut never = vec![
            facts.no_timestamps,
            facts.sot,
            facts.no_speech,
            facts.translate,
        ];
        if first {
            never.extend([facts.eot, facts.blank]);
        }
        for token in never {
            if let Some(score) = scores.get_mut(token as usize) {
                *score = f32::NEG_INFINITY;
            }
        }
    }
}

impl Recognizer for Whisper {
    fn transcribe(&mut self, samples: &[f32], language: Option<&str>) -> Result<String, String> {
        let heard = self.encode(samples)?;
        let language = self.language(language, &heard)?;
        let mut cache = self.cache();
        let start = [
            self.facts.sot,
            language,
            self.facts.transcribe,
            self.facts.no_timestamps,
        ];
        let mut scores = self.step(&start, &mut cache, &heard)?;
        self.suppress(&mut scores, true);
        let mut said = Vec::new();
        let most = self.facts.context / 2;
        loop {
            let token = argmax(&scores) as i64;
            if token == self.facts.eot || said.len() >= most {
                break;
            }
            said.push(token);
            scores = self.step(&[token], &mut cache, &heard)?;
            self.suppress(&mut scores, false);
        }
        Ok(tokens::text(&said, &self.vocabulary))
    }

    fn longest(&self) -> usize {
        LONGEST - TAIL
    }
}
