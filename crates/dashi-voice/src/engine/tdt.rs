//! Greedy decoding for a token-and-duration transducer (TDT), as Parakeet is:
//! at each frame of the encoder the model names a token and how many frames
//! to move on. A blank names nothing. The model's memory moves on only when a
//! token is named.

use super::tensor::argmax;

/// Tokens named on one frame before the decoder moves on regardless.
const MOST_PER_FRAME: usize = 10;

/// The decoder and joiner: one step of the transducer.
pub(crate) trait Predictor {
    type Memory;
    /// The memory before anything was said.
    fn start(&self) -> Self::Memory;
    /// For encoder frame `frame` after token `last` (the blank at first): the
    /// scores (every token, the blank last, then every duration) and the
    /// memory to keep if a token is named.
    fn step(
        &mut self,
        frame: usize,
        last: usize,
        memory: &Self::Memory,
    ) -> Result<(Vec<f32>, Self::Memory), String>;
}

/// A token and the encoder frame it was named on.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) struct Named {
    pub(crate) token: usize,
    pub(crate) frame: usize,
}

/// The tokens for `frames` frames of the encoder; `tokens` counts the blank, which is the last.
pub(crate) fn decode<P: Predictor>(
    predictor: &mut P,
    frames: usize,
    tokens: usize,
) -> Result<Vec<Named>, String> {
    let blank = tokens - 1;
    let mut memory = predictor.start();
    let mut named = Vec::new();
    let mut last = blank;
    let mut frame = 0;
    let mut here = 0;
    while frame < frames {
        let (scores, next) = predictor.step(frame, last, &memory)?;
        if scores.len() <= tokens {
            return Err("the speech model's answer is the wrong size".into());
        }
        let token = argmax(&scores[..tokens]);
        let skip = argmax(&scores[tokens..]);
        if token != blank {
            memory = next;
            last = token;
            named.push(Named { token, frame });
            here += 1;
        }
        if skip > 0 {
            frame += skip;
            here = 0;
        } else if token == blank || here >= MOST_PER_FRAME {
            frame += 1;
            here = 0;
        }
    }
    Ok(named)
}

/// The words tokens spell: a token that starts with "▁" starts a word.
pub(crate) fn text(named: &[Named], vocabulary: &[String]) -> String {
    let mut text = String::new();
    for each in named {
        if let Some(piece) = vocabulary.get(each.token) {
            text.push_str(&piece.replace('▁', " "));
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The vocabulary from `vocab.txt`: a token and its number on each line.
pub(crate) fn vocabulary(file: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    for line in file.lines().filter(|line| !line.is_empty()) {
        let (token, id) = line
            .rsplit_once(' ')
            .ok_or("the speech model's vocabulary can't be read")?;
        let id: usize = id
            .parse()
            .map_err(|_| "the speech model's vocabulary can't be read")?;
        if id != tokens.len() {
            return Err("the speech model's vocabulary is out of order".into());
        }
        tokens.push(token.to_owned());
    }
    if tokens.last().map(String::as_str) != Some("<blk>") {
        return Err("the speech model's vocabulary has no blank".into());
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A script of (token, skip) answers, one per step; the memory counts the tokens named.
    struct Script {
        answers: Vec<(usize, usize)>,
        asked: Vec<(usize, usize, usize)>,
    }

    impl Predictor for Script {
        type Memory = usize;
        fn start(&self) -> usize {
            0
        }
        fn step(
            &mut self,
            frame: usize,
            last: usize,
            memory: &usize,
        ) -> Result<(Vec<f32>, usize), String> {
            let (token, skip) = self.answers[self.asked.len()];
            self.asked.push((frame, last, *memory));
            // Four tokens (3 is the blank), then three durations.
            let mut scores = vec![0.0; 7];
            scores[token] = 1.0;
            scores[4 + skip] = 1.0;
            Ok((scores, memory + 1))
        }
    }

    #[test]
    fn tokens_durations_and_blanks_move_the_decoder() {
        let mut script = Script {
            answers: vec![(0, 0), (1, 2), (3, 0), (3, 1), (2, 1)],
            asked: Vec::new(),
        };
        let named = decode(&mut script, 5, 4).unwrap();
        assert_eq!(
            named,
            vec![
                Named { token: 0, frame: 0 },
                Named { token: 1, frame: 0 },
                Named { token: 2, frame: 4 },
            ]
        );
        // The memory moved only when a token was named; a blank left it and the last token alone.
        assert_eq!(
            script.asked,
            vec![(0, 3, 0), (0, 0, 1), (2, 1, 2), (3, 1, 2), (4, 1, 2)]
        );
    }

    #[test]
    fn a_model_stuck_on_one_frame_is_moved_on() {
        let mut script = Script {
            answers: vec![(0, 0); 30],
            asked: Vec::new(),
        };
        let named = decode(&mut script, 3, 4).unwrap();
        assert_eq!(named.len(), 30);
        assert_eq!(named[9].frame, 0);
        assert_eq!(named[10].frame, 1);
    }

    #[test]
    fn tokens_spell_words() {
        let vocabulary = vocabulary("<unk> 0\n▁he 1\nllo 2\n▁there 3\n. 4\n<blk> 5\n").unwrap();
        let named: Vec<Named> = [1, 2, 3, 4]
            .into_iter()
            .map(|token| Named { token, frame: 0 })
            .collect();
        assert_eq!(text(&named, &vocabulary), "hello there.");
        assert!(super::vocabulary("a 0\nb 2\n").is_err());
        assert!(super::vocabulary("a 0\nb 1\n").is_err());
    }
}
