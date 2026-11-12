//! A sentence as Kokoro takes it: the numbers of its phonemes and
//! punctuation, and which of them belong to which written word, so each word
//! can be timed. A sentence too long for the model is cut into parts at a
//! pause, or between words when it has none.

use super::phonemes::{Language, Phonemizer};
use super::vocab::{self, MOST_TOKENS};

const SPACE: char = ' ';

/// A written word and its tokens: `first..end` in the part's tokens.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Span {
    pub(crate) text: String,
    pub(crate) first: usize,
    pub(crate) end: usize,
}

/// One run of the model.
#[derive(Debug, PartialEq, Eq, Default)]
pub(crate) struct Part {
    pub(crate) tokens: Vec<i64>,
    pub(crate) words: Vec<Span>,
}

/// A written word: its tokens, and whether a pause follows it.
struct Atom {
    text: String,
    tokens: Vec<i64>,
    pause: bool,
}

/// A written word taken apart: what to say, and the punctuation around it.
struct Written<'a> {
    text: &'a str,
    before: Vec<i64>,
    core: String,
    after: Vec<i64>,
}

/// The punctuation Kokoro knows for a written mark; none drops it.
fn mark(character: char) -> Option<char> {
    match character {
        '«' | '„' => Some('“'),
        '»' => Some('”'),
        '–' | '―' => Some('—'),
        '[' | '{' => Some('('),
        ']' | '}' => Some(')'),
        _ if vocab::is_punctuation(character) => Some(character),
        _ => None,
    }
}

/// Letters and digits are said; so is what joins them inside a word ("can't", "3.5", "e-mail").
fn said(character: char) -> bool {
    character.is_alphanumeric()
}

fn written(text: &str) -> Written<'_> {
    let first = text.find(said).unwrap_or(text.len());
    let last = text
        .char_indices()
        .rev()
        .find(|(_, character)| said(*character))
        .map_or(first, |(at, character)| at + character.len_utf8());
    let marks = |part: &str| -> Vec<i64> {
        part.chars()
            .filter_map(mark)
            .filter_map(vocab::id)
            .collect()
    };
    Written {
        text,
        before: marks(&text[..first]),
        core: text[first..last].to_owned(),
        after: marks(&text[last..]),
    }
}

/// The atoms of one run of words with no pause inside it.
fn clause(
    words: &[Written],
    language: Language,
    phonemizer: &mut dyn Phonemizer,
) -> Result<Vec<Atom>, String> {
    // A mark alone ("–") is a word on screen with nothing to say but its pause.
    let spoken: Vec<&Written> = words.iter().filter(|word| !word.core.is_empty()).collect();
    let phrase = spoken
        .iter()
        .map(|word| word.core.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let phonemes = if phrase.is_empty() {
        String::new()
    } else {
        phonemizer.phonemes(&phrase, language)?
    };
    let said: Vec<&str> = phonemes
        .split(SPACE)
        .filter(|word| !word.is_empty())
        .collect();
    // eSpeak gave a word for each word: each has its own phonemes. If it
    // joined or split some (numbers, "tout le monde"), the phrase's phonemes
    // are shared out by the words' lengths.
    let mut each = if said.len() == spoken.len() {
        said.iter().map(|word| vocab::ids(word)).collect()
    } else {
        share(&vocab::ids(&phonemes), &spoken)
    }
    .into_iter();
    let last = words.len().saturating_sub(1);
    Ok(words
        .iter()
        .enumerate()
        .map(|(index, word)| {
            let mut tokens = word.before.clone();
            if !word.core.is_empty() {
                tokens.extend(each.next().unwrap_or_default());
            }
            tokens.extend(&word.after);
            Atom {
                text: word.text.to_owned(),
                tokens,
                pause: index == last && !word.after.is_empty(),
            }
        })
        .collect())
}

/// A phrase's tokens cut among its words, by how long each is written.
fn share(tokens: &[i64], words: &[&Written]) -> Vec<Vec<i64>> {
    let space = vocab::id(SPACE);
    let tokens: Vec<i64> = tokens
        .iter()
        .copied()
        .filter(|id| Some(*id) != space)
        .collect();
    let lengths: Vec<usize> = words
        .iter()
        .map(|word| word.core.chars().count().max(1))
        .collect();
    let total: usize = lengths.iter().sum();
    let mut cut = Vec::with_capacity(words.len());
    let (mut written, mut from) = (0, 0);
    for length in lengths {
        written += length;
        let to = (tokens.len() * written / total.max(1)).max(from);
        cut.push(tokens[from..to].to_vec());
        from = to;
    }
    cut
}

fn atoms(
    sentence: &str,
    language: Language,
    phonemizer: &mut dyn Phonemizer,
) -> Result<Vec<Atom>, String> {
    let mut atoms = Vec::new();
    let mut run: Vec<Written> = Vec::new();
    for text in sentence.split_whitespace() {
        let word = written(text);
        // A mark before a word ends the run before it; one after it ends the run with it.
        if !word.before.is_empty() && !run.is_empty() {
            atoms.extend(clause(&run, language, phonemizer)?);
            run.clear();
        }
        let ends = !word.after.is_empty();
        run.push(word);
        if ends {
            atoms.extend(clause(&run, language, phonemizer)?);
            run.clear();
        }
    }
    if !run.is_empty() {
        atoms.extend(clause(&run, language, phonemizer)?);
    }
    Ok(atoms)
}

/// The parts of a sentence, each within the model's limit.
pub(crate) fn plan(
    sentence: &str,
    language: Language,
    phonemizer: &mut dyn Phonemizer,
) -> Result<Vec<Part>, String> {
    pack(atoms(sentence, language, phonemizer)?, MOST_TOKENS)
}

fn pack(atoms: Vec<Atom>, most: usize) -> Result<Vec<Part>, String> {
    let space = vocab::id(SPACE).unwrap_or(16);
    let mut parts = Vec::new();
    let mut part = Part::default();
    // Where the part could end at a pause: (words, tokens) then.
    let mut pause: Option<(usize, usize)> = None;
    for atom in atoms {
        if atom.tokens.len() > most {
            return Err("a word is too long to say".into());
        }
        if part.tokens.len() + 1 + atom.tokens.len() > most {
            let (words, tokens) = pause
                .filter(|(_, tokens)| *tokens * 2 >= most)
                .unwrap_or((part.words.len(), part.tokens.len()));
            let rest = Part {
                tokens: part.tokens.split_off(tokens),
                words: part.words.split_off(words),
            };
            parts.push(std::mem::take(&mut part));
            // What came after the cut starts the next part, numbered from its own start.
            let skip = rest.tokens.iter().take_while(|id| **id == space).count();
            part.tokens = rest.tokens[skip..].to_vec();
            part.words = rest
                .words
                .into_iter()
                .map(|span| Span {
                    first: span.first - tokens - skip,
                    end: span.end - tokens - skip,
                    ..span
                })
                .collect();
            pause = None;
        }
        if !part.tokens.is_empty() {
            part.tokens.push(space);
        }
        let first = part.tokens.len();
        part.tokens.extend(&atom.tokens);
        part.words.push(Span {
            text: atom.text,
            first,
            end: part.tokens.len(),
        });
        if atom.pause {
            pause = Some((part.words.len(), part.tokens.len()));
        }
    }
    if !part.words.is_empty() {
        parts.push(part);
    }
    Ok(parts)
}

#[cfg(test)]
#[path = "plan_tests.rs"]
mod tests;
