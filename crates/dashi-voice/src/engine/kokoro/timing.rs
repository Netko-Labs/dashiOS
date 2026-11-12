//! When each word is said. Kokoro tells how long each token lasts; a word
//! begins where its first token does and ends where its last one does. The
//! lengths are scaled to the sound that came out, so they always add up to it.

use super::plan::Part;
use crate::engine::Word;

/// The words of a part with their times, in milliseconds from the part's
/// start. `lengths` has one number per token and one for the pad at each end.
pub(crate) fn words(part: &Part, lengths: &[f32], sound_ms: f64) -> Vec<Word> {
    let total: f64 = lengths
        .iter()
        .map(|length| f64::from(length.max(0.0)))
        .sum();
    let known = total > 0.0 && lengths.len() == part.tokens.len() + 2;
    let mut starts = Vec::with_capacity(lengths.len() + 1);
    let mut sum = 0.0;
    for length in lengths {
        starts.push(sum);
        sum += f64::from(length.max(0.0));
    }
    starts.push(sum);
    part.words
        .iter()
        .map(|span| {
            let (start, end) = if known {
                // Token n is length n + 1: the first length is the pad's.
                (starts[span.first + 1] / total, starts[span.end + 1] / total)
            } else {
                // No lengths to go by: share the sound by the tokens' count.
                let tokens = part.tokens.len().max(1) as f64;
                (span.first as f64 / tokens, span.end as f64 / tokens)
            };
            Word {
                text: span.text.clone(),
                start_ms: (start * sound_ms).round() as u64,
                end_ms: (end * sound_ms).round() as u64,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::plan::Span;
    use super::*;

    fn part() -> Part {
        Part {
            tokens: vec![1, 2, 3, 4, 5],
            words: vec![
                Span {
                    text: "one".into(),
                    first: 0,
                    end: 2,
                },
                Span {
                    text: "two".into(),
                    first: 3,
                    end: 5,
                },
            ],
        }
    }

    #[test]
    fn a_word_spans_its_tokens_lengths() {
        // Pad 2, tokens 4 4 2 3 3, pad 2: 20 in all, for a second of sound.
        let words = words(&part(), &[2.0, 4.0, 4.0, 2.0, 3.0, 3.0, 2.0], 1000.0);
        assert_eq!((words[0].start_ms, words[0].end_ms), (100, 500));
        assert_eq!((words[1].start_ms, words[1].end_ms), (600, 900));
        assert_eq!(words[1].text, "two");
    }

    #[test]
    fn without_lengths_the_sound_is_shared_evenly() {
        let words = words(&part(), &[], 1000.0);
        assert_eq!((words[0].start_ms, words[0].end_ms), (0, 400));
        assert_eq!((words[1].start_ms, words[1].end_ms), (600, 1000));
    }
}
