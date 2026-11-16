//! The evidence in one sentence: its words (the common ones of each
//! language), its letters (ñ, ¿, ã, è, Devanagari) and a few endings
//! ("don't", "l'ami", "-ing"). A name or an English term inside a Spanish
//! sentence is one word against the sentence's many: the most evidence wins.

use std::collections::HashMap;
use std::sync::OnceLock;

use super::Tongue::{self, English, French, Hindi, Italian, Portuguese, Spanish};
use super::{words, words_more};

/// A score for each tongue, in `Tongue::ALL`'s order.
type Scores = [f32; 6];

/// The least evidence that tells a tongue, and the least it must lead the next by.
const LEAST: f32 = 1.0;
const LEAD: f32 = 0.75;

fn at(tongue: Tongue) -> usize {
    Tongue::ALL
        .iter()
        .position(|each| *each == tongue)
        .unwrap_or(0)
}

/// Every listed word and what it weighs for each tongue: 2 for a word that
/// holds sentences together ("the", "que"), 1 for a common one ("open", "abre").
fn lexicon() -> &'static HashMap<&'static str, Scores> {
    static LEXICON: OnceLock<HashMap<&'static str, Scores>> = OnceLock::new();
    LEXICON.get_or_init(|| {
        let lists = [
            (English, words::ENGLISH_GLUE, words::ENGLISH),
            (Spanish, words::SPANISH_GLUE, words::SPANISH),
            (French, words_more::FRENCH_GLUE, words_more::FRENCH),
            (Italian, words_more::ITALIAN_GLUE, words_more::ITALIAN),
            (
                Portuguese,
                words_more::PORTUGUESE_GLUE,
                words_more::PORTUGUESE,
            ),
        ];
        let mut lexicon: HashMap<&'static str, Scores> = HashMap::new();
        for (tongue, glue, common) in lists {
            for (list, weight) in [(glue, 2.0_f32), (common, 1.0)] {
                for word in list.split_whitespace() {
                    let scores = lexicon.entry(word).or_default();
                    scores[at(tongue)] = weight.max(scores[at(tongue)]);
                }
            }
        }
        lexicon
    })
}

/// What a letter says by itself.
fn letter(character: char) -> &'static [(Tongue, f32)] {
    match character {
        'ñ' | '¿' | '¡' => &[(Spanish, 3.0)],
        'ã' | 'õ' => &[(Portuguese, 3.0)],
        'á' | 'í' | 'ó' | 'ú' => &[(Spanish, 1.0), (Portuguese, 1.0)],
        'é' => &[(Spanish, 0.75), (French, 0.75), (Portuguese, 0.75)],
        'ü' => &[(Spanish, 0.5)],
        'ç' => &[(Portuguese, 1.5), (French, 1.5)],
        'è' | 'ù' => &[(French, 1.0), (Italian, 1.0)],
        'à' => &[(French, 1.0), (Italian, 1.0), (Portuguese, 1.0)],
        'ê' | 'â' | 'ô' => &[(French, 1.0), (Portuguese, 1.0)],
        'î' | 'û' | 'œ' | 'ë' | 'ï' => &[(French, 1.5)],
        'ì' | 'ò' => &[(Italian, 2.0)],
        _ => &[],
    }
}

/// What follows an apostrophe in English ("don't", "it's"), and what comes
/// before one in French and Italian ("l'ami", "dell'acqua").
const AFTER: [&str; 7] = ["s", "t", "ll", "re", "ve", "m", "d"];
const BEFORE_FRENCH: [&str; 9] = ["l", "d", "j", "qu", "c", "n", "s", "m", "t"];
const BEFORE_ITALIAN: [&str; 9] = ["l", "dell", "nell", "all", "sull", "dall", "un", "c", "d"];

/// What a word's shape says when the word itself is not listed.
fn shape(word: &str, scores: &mut Scores) {
    if let Some((before, after)) = word.split_once('\'') {
        if AFTER.contains(&after) {
            scores[at(English)] += 2.0;
        } else if after.chars().count() >= 2 {
            if BEFORE_FRENCH.contains(&before) {
                scores[at(French)] += 2.0;
            }
            if BEFORE_ITALIAN.contains(&before) {
                scores[at(Italian)] += 2.0;
            }
        }
        return;
    }
    let long = word.chars().count() >= 5;
    if long && word.ends_with("ing") {
        scores[at(English)] += 0.75;
    }
    if ["th", "wh", "sh", "ck", "ght"]
        .iter()
        .any(|pair| word.contains(pair))
    {
        scores[at(English)] += 0.5;
    }
    if long && word.ends_with("mente") {
        for tongue in [Spanish, Italian, Portuguese] {
            scores[at(tongue)] += 0.5;
        }
    }
    if long && (word.ends_with("ando") || word.ends_with("endo")) {
        for tongue in [Spanish, Italian, Portuguese] {
            scores[at(tongue)] += 0.5;
        }
    }
}

/// A sound said while thinking ("um", "uh", "eh"): every language has it, so
/// it tells none. "um" is also Portuguese for "a", and a dictation of "Um."
/// was told as Portuguese (the owner's corpus, row 40).
fn is_filler(word: &str) -> bool {
    matches!(
        word,
        "um" | "umm"
            | "uh"
            | "uhh"
            | "uhm"
            | "eh"
            | "ehm"
            | "ah"
            | "er"
            | "erm"
            | "hm"
            | "hmm"
            | "mm"
            | "mhm"
    )
}

/// One word's evidence. `named` is a capital inside the sentence: a name
/// (Helium, YouTube, Settings), which says nothing of the sentence's tongue.
fn weigh(written: &str, named: bool, scores: &mut Scores) {
    if written == "I" {
        scores[at(English)] += 2.0;
        return;
    }
    // The marks that open a Spanish sentence count wherever they are; a name's letters ("Toño") do not.
    let word = written.to_lowercase().replace('’', "'");
    for character in word.chars() {
        for (tongue, weight) in letter(character) {
            if !named || "¿¡".contains(character) {
                scores[at(*tongue)] += weight;
            }
        }
    }
    let word = word.trim_matches(['\'', '¿', '¡']);
    if named || is_filler(word) {
        return;
    }
    if let Some(listed) = lexicon().get(word) {
        for (score, weight) in scores.iter_mut().zip(listed) {
            *score += weight;
        }
    } else {
        shape(word, scores);
    }
}

/// Most of the letters are Devanagari: Hindi, whatever else is in it.
fn devanagari(sentence: &str) -> bool {
    let letters = sentence.chars().filter(|c| c.is_alphabetic()).count();
    let ours = sentence
        .chars()
        .filter(|c| ('\u{900}'..='\u{97f}').contains(c))
        .count();
    ours > 0 && ours * 2 >= letters
}

/// The tongue this sentence gives evidence of, among those that may be
/// spoken; none when it gives too little, or as much for two.
pub(crate) fn evidence(sentence: &str, among: &[Tongue]) -> Option<Tongue> {
    if devanagari(sentence) {
        return among.contains(&Hindi).then_some(Hindi);
    }
    let mut scores = Scores::default();
    let is_word = |c: char| c.is_alphabetic() || c == '\'' || c == '’';
    let mut first = true;
    for written in sentence.split(|c: char| !is_word(c) && !"¿¡".contains(c)) {
        if written.is_empty() {
            continue;
        }
        let capital = written.chars().find(|c| c.is_alphabetic());
        let named = !first && capital.is_some_and(char::is_uppercase);
        weigh(written, named, &mut scores);
        first = first && capital.is_none();
    }
    let mut ranked: Vec<(Tongue, f32)> = among
        .iter()
        .map(|tongue| (*tongue, scores[at(*tongue)]))
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let (best, most) = *ranked.first()?;
    let next = ranked.get(1).map_or(0.0, |(_, score)| *score);
    (most >= LEAST && most - next >= LEAD).then_some(best)
}
