//! Speech to text: NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), as ONNX
//! (istupakov/parakeet-tdt-0.6b-v3-onnx): a mel preprocessor, the
//! FastConformer encoder (int8), and the TDT decoder and joint network.
//! Twenty-five European languages; it finds the language itself.

use ort::{session::Session, value::Tensor};

use crate::models;

/// TDT's durations: how many encoder frames each prediction moves on.
const DURATIONS: [usize; 5] = [0, 1, 2, 3, 4];
/// At most this many tokens on one encoder frame before moving on.
const MAX_SYMBOLS_PER_FRAME: usize = 10;
/// The prediction network's LSTM: 2 layers of 640.
const STATE: usize = 2 * 640;

/// One step of the joint network, behind a trait so the decoding loop is tested on its own.
pub(crate) trait Joint {
    /// The best token and duration index for `frame`, after `last` (the blank at the start).
    fn predict(&mut self, frame: usize, last: usize) -> Result<(usize, usize), String>;
    /// Keep the prediction network's state from the last `predict` (a token was emitted).
    fn accept(&mut self);
}

/// TDT greedy decoding: the tokens, in order.
pub(crate) fn decode_tdt(
    joint: &mut impl Joint,
    frames: usize,
    blank: usize,
) -> Result<Vec<usize>, String> {
    let mut tokens = Vec::new();
    let mut frame = 0;
    let mut emitted = 0;
    while frame < frames {
        let last = tokens.last().copied().unwrap_or(blank);
        let (token, duration) = joint.predict(frame, last)?;
        if token != blank {
            joint.accept();
            tokens.push(token);
            emitted += 1;
        }
        let skip = DURATIONS.get(duration).copied().unwrap_or(1);
        if skip > 0 {
            frame += skip;
            emitted = 0;
        } else if token == blank || emitted >= MAX_SYMBOLS_PER_FRAME {
            frame += 1;
            emitted = 0;
        }
    }
    Ok(tokens)
}

/// The vocabulary: `token id` per line; `▁` starts a word.
pub(crate) fn parse_vocab(text: &str) -> Result<Vec<String>, String> {
    let mut vocab: Vec<String> = Vec::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let (token, id) = line
            .rsplit_once(' ')
            .ok_or_else(|| format!("bad vocabulary line: {line}"))?;
        let id: usize = id
            .trim()
            .parse()
            .map_err(|_| format!("bad vocabulary id: {line}"))?;
        if id >= vocab.len() {
            vocab.resize(id + 1, String::new());
        }
        vocab[id] = token.to_string();
    }
    Ok(vocab)
}

/// Tokens back to words.
pub(crate) fn detokenize(vocab: &[String], tokens: &[usize]) -> String {
    let text: String = tokens
        .iter()
        .filter_map(|&token| vocab.get(token))
        .filter(|piece| !(piece.starts_with('<') && piece.ends_with('>')))
        .map(|piece| piece.replace('\u{2581}', " "))
        .collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) struct Parakeet {
    preprocessor: Session,
    encoder: Session,
    decoder: Session,
    vocab: Vec<String>,
    blank: usize,
}

impl Parakeet {
    pub(crate) fn load(paths: &models::Paths) -> Result<Self, String> {
        let threads = models::threads();
        let vocab_text = std::fs::read_to_string(paths.parakeet("vocab.txt"))
            .map_err(|error| format!("vocab.txt: {error}"))?;
        let vocab = parse_vocab(&vocab_text)?;
        let blank = vocab
            .iter()
            .position(|token| token == "<blk>")
            .unwrap_or(vocab.len().saturating_sub(1));
        Ok(Self {
            preprocessor: models::session(&paths.parakeet("nemo128.onnx"), threads)?,
            encoder: models::session(&paths.parakeet("encoder-model.int8.onnx"), threads)?,
            decoder: models::session(&paths.parakeet("decoder_joint-model.int8.onnx"), threads)?,
            vocab,
            blank,
        })
    }

    /// 16 kHz mono samples to text.
    pub(crate) fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        if samples.len() < 1_600 {
            return Ok(String::new());
        }
        let fail = |error: ort::Error| format!("speech to text: {error}");
        let waveforms =
            Tensor::from_array(([1usize, samples.len()], samples.to_vec())).map_err(fail)?;
        let lengths = Tensor::from_array(([1usize], vec![samples.len() as i64])).map_err(fail)?;
        let features = self
            .preprocessor
            .run(ort::inputs!["waveforms" => waveforms, "waveforms_lens" => lengths])
            .map_err(fail)?;
        let (shape, mel) = features["features"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        let mel_shape: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
        let (_, mel_lengths) = features["features_lens"]
            .try_extract_tensor::<i64>()
            .map_err(fail)?;
        let signal = Tensor::from_array((mel_shape, mel.to_vec())).map_err(fail)?;
        let length = Tensor::from_array(([1usize], mel_lengths.to_vec())).map_err(fail)?;
        drop(features);

        let encoded = self
            .encoder
            .run(ort::inputs!["audio_signal" => signal, "length" => length])
            .map_err(fail)?;
        let (shape, outputs) = encoded["outputs"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        let (dims, steps) = (shape[1] as usize, shape[2] as usize);
        let (_, encoded_lengths) = encoded["encoded_lengths"]
            .try_extract_tensor::<i64>()
            .map_err(fail)?;
        let frames = (encoded_lengths.first().copied().unwrap_or(0).max(0) as usize).min(steps);
        // [1, D, T] to one D-vector per frame.
        let mut by_frame = vec![0.0f32; steps * dims];
        for d in 0..dims {
            for t in 0..steps {
                by_frame[t * dims + d] = outputs[d * steps + t];
            }
        }
        drop(encoded);

        let mut joint = OnnxJoint {
            session: &mut self.decoder,
            frames: by_frame,
            dims,
            state: (vec![0.0; STATE], vec![0.0; STATE]),
            pending: None,
            vocab_size: self.vocab.len(),
        };
        let tokens = decode_tdt(&mut joint, frames, self.blank)?;
        Ok(detokenize(&self.vocab, &tokens))
    }
}

struct OnnxJoint<'a> {
    session: &'a mut Session,
    frames: Vec<f32>,
    dims: usize,
    state: (Vec<f32>, Vec<f32>),
    pending: Option<(Vec<f32>, Vec<f32>)>,
    vocab_size: usize,
}

impl Joint for OnnxJoint<'_> {
    fn predict(&mut self, frame: usize, last: usize) -> Result<(usize, usize), String> {
        let fail = |error: ort::Error| format!("speech to text: {error}");
        let vector = self.frames[frame * self.dims..(frame + 1) * self.dims].to_vec();
        let encoder_outputs = Tensor::from_array(([1usize, self.dims, 1], vector)).map_err(fail)?;
        let targets = Tensor::from_array(([1usize, 1], vec![last as i32])).map_err(fail)?;
        let target_length = Tensor::from_array(([1usize], vec![1i32])).map_err(fail)?;
        let state_1 = Tensor::from_array(([2usize, 1, 640], self.state.0.clone())).map_err(fail)?;
        let state_2 = Tensor::from_array(([2usize, 1, 640], self.state.1.clone())).map_err(fail)?;
        let outputs = self
            .session
            .run(ort::inputs![
                "encoder_outputs" => encoder_outputs,
                "targets" => targets,
                "target_length" => target_length,
                "input_states_1" => state_1,
                "input_states_2" => state_2,
            ])
            .map_err(fail)?;
        let (_, logits) = outputs["outputs"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        let vocab = self.vocab_size.min(logits.len());
        let token = argmax(&logits[..vocab]);
        let duration = argmax(&logits[vocab..]);
        let (_, next_1) = outputs["output_states_1"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        let (_, next_2) = outputs["output_states_2"]
            .try_extract_tensor::<f32>()
            .map_err(fail)?;
        self.pending = Some((next_1.to_vec(), next_2.to_vec()));
        Ok((token, duration))
    }

    fn accept(&mut self) {
        if let Some(state) = self.pending.take() {
            self.state = state;
        }
    }
}

fn argmax(values: &[f32]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .map_or(0, |(index, _)| index)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Plays back (token, duration) per call, and records what it was asked.
    struct Script {
        steps: Vec<(usize, usize)>,
        asked: Vec<(usize, usize)>,
        accepted: usize,
    }

    impl Joint for Script {
        fn predict(&mut self, frame: usize, last: usize) -> Result<(usize, usize), String> {
            self.asked.push((frame, last));
            Ok(self
                .steps
                .get(self.asked.len() - 1)
                .copied()
                .unwrap_or((BLANK, 1)))
        }
        fn accept(&mut self) {
            self.accepted += 1;
        }
    }

    const BLANK: usize = 9;

    #[test]
    fn tdt_skips_frames_by_duration() {
        // "a" then skip 2, blank skip 1, "b" with duration 0 then "c" on the same frame.
        let mut script = Script {
            steps: vec![(1, 2), (BLANK, 1), (2, 0), (3, 1)],
            asked: Vec::new(),
            accepted: 0,
        };
        let tokens = decode_tdt(&mut script, 5, BLANK).unwrap();
        assert_eq!(tokens, vec![1, 2, 3]);
        assert_eq!(
            script.asked,
            vec![(0, BLANK), (2, 1), (3, 1), (3, 2), (4, 3)]
        );
        assert_eq!(script.accepted, 3);
    }

    #[test]
    fn a_blank_with_no_duration_still_moves_on() {
        let mut script = Script {
            steps: vec![(BLANK, 0), (BLANK, 0)],
            asked: Vec::new(),
            accepted: 0,
        };
        assert!(decode_tdt(&mut script, 2, BLANK).unwrap().is_empty());
        assert_eq!(script.asked.len(), 2);
    }

    #[test]
    fn too_many_tokens_on_a_frame_moves_on() {
        let mut script = Script {
            steps: vec![(1, 0); 30],
            asked: Vec::new(),
            accepted: 0,
        };
        let tokens = decode_tdt(&mut script, 2, BLANK).unwrap();
        assert_eq!(tokens.len(), 2 * MAX_SYMBOLS_PER_FRAME);
    }

    #[test]
    fn words_from_pieces() {
        let vocab = parse_vocab("<unk> 0\n\u{2581}turn 1\n\u{2581}on 2\n\u{2581}dark 3\n\u{2581}mo 4\nde 5\n. 6\n<blk> 7\n").unwrap();
        assert_eq!(vocab.len(), 8);
        assert_eq!(
            detokenize(&vocab, &[1, 2, 3, 4, 5, 6]),
            "turn on dark mode."
        );
        assert_eq!(detokenize(&vocab, &[0, 1]), "turn");
    }

    #[test]
    fn a_bad_vocabulary_is_an_error() {
        assert!(parse_vocab("nospace").is_err());
        assert!(parse_vocab("tok x").is_err());
    }
}
