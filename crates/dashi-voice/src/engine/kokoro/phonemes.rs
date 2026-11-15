//! Words to phonemes. eSpeak NG says how a phrase sounds (IPA); it is run as
//! a separate program (`espeak-ng`, GPL-3.0-or-later, never linked) and its
//! answer is turned into the letters Kokoro was trained on. The table of
//! which eSpeak sound is which Kokoro letter follows misaki's eSpeak
//! fallback (hexgrad/misaki, Apache-2.0; THIRD-PARTY-NOTICES.md).

use std::io::Write;
use std::process::{Command, Stdio};

/// eSpeak joins the letters of one sound with this.
const TIE: char = '^';

/// A language Kokoro speaks, by the first letter of its voices' names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Language {
    /// Kokoro's letter: `a` American, `b` British, `e` Spanish, …
    pub(crate) letter: char,
    /// ISO 639-1, with the region where Kokoro tells them apart.
    pub(crate) code: &'static str,
    /// eSpeak's voice for it.
    pub(crate) espeak: &'static str,
    pub(crate) name: &'static str,
}

/// Kokoro's Japanese and Mandarin voices need dictionaries eSpeak lacks: not offered.
pub(crate) const LANGUAGES: [Language; 7] = [
    Language {
        letter: 'a',
        code: "en-US",
        espeak: "en-us",
        name: "English (US)",
    },
    Language {
        letter: 'b',
        code: "en-GB",
        espeak: "en-gb",
        name: "English (UK)",
    },
    Language {
        letter: 'e',
        code: "es",
        espeak: "es",
        name: "Spanish",
    },
    Language {
        letter: 'f',
        code: "fr",
        espeak: "fr-fr",
        name: "French",
    },
    Language {
        letter: 'h',
        code: "hi",
        espeak: "hi",
        name: "Hindi",
    },
    Language {
        letter: 'i',
        code: "it",
        espeak: "it",
        name: "Italian",
    },
    Language {
        letter: 'p',
        code: "pt-BR",
        espeak: "pt-br",
        name: "Portuguese (Brazil)",
    },
];

/// The language a voice speaks: `af_heart` is American English.
pub(crate) fn of_voice(voice: &str) -> Option<Language> {
    let letter = voice.chars().next()?;
    LANGUAGES
        .into_iter()
        .find(|language| language.letter == letter)
}

/// Spanish as most of its speakers say it ("gracias" with an s): for a tag
/// whose region is not Spain. The voices are the same; eSpeak's rules differ.
pub(crate) const LATIN_SPANISH: Language = Language {
    letter: 'e',
    code: "es-419",
    espeak: "es-419",
    name: "Spanish (Latin America)",
};

fn primary(tag: &str) -> String {
    tag.split(['-', '_']).next().unwrap_or("").to_lowercase()
}

/// The language a sentence is read in: the tag's when one is given ("es-CO"
/// is Latin American Spanish, "en-GB" British), else the voice's own. A tag
/// that only names the voice's language ("en" for a British voice) keeps
/// the voice's own.
pub(crate) fn read_as(voice: &str, tag: Option<&str>) -> Option<Language> {
    let own = of_voice(voice);
    let Some(tag) = tag else {
        return own;
    };
    let exact = LANGUAGES
        .into_iter()
        .find(|known| known.code.eq_ignore_ascii_case(tag));
    if exact.is_some() {
        return exact;
    }
    let region = tag.split(['-', '_']).nth(1).unwrap_or("");
    if primary(tag) == "es" && !region.is_empty() && !region.eq_ignore_ascii_case("ES") {
        return Some(LATIN_SPANISH);
    }
    own.filter(|own| primary(own.code) == primary(tag))
        .or_else(|| {
            LANGUAGES
                .into_iter()
                .find(|known| primary(known.code) == primary(tag))
        })
}

/// Says how a phrase with no punctuation sounds, a word of phonemes for each
/// word where it can.
pub(crate) trait Phonemizer: Send {
    fn phonemes(&mut self, phrase: &str, language: Language) -> Result<String, String>;
}

/// The `espeak-ng` program.
pub(crate) struct Espeak;

impl Phonemizer for Espeak {
    fn phonemes(&mut self, phrase: &str, language: Language) -> Result<String, String> {
        let missing = |_| "eSpeak NG is not installed (the espeak-ng package)".to_owned();
        let mut child = Command::new("espeak-ng")
            .args(["-q", "--ipa", "--tie=^", "-v", language.espeak, "--stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(missing)?;
        if let Some(mut stdin) = child.stdin.take() {
            // The phrase goes in on stdin: as an argument, one that begins with "-" would be an option.
            // Without the line's end eSpeak drops the last letter.
            let _ = stdin.write_all(format!("{phrase}\n").as_bytes());
        }
        let output = child.wait_with_output().map_err(missing)?;
        if !output.status.success() {
            return Err(format!("eSpeak NG can't say {}", language.name));
        }
        let raw = String::from_utf8_lossy(&output.stdout);
        Ok(kokoro_letters(&raw, language))
    }
}

/// eSpeak's sounds that are one Kokoro letter in every language, longest first.
const EVERYWHERE: &[(&str, &str)] = &[
    ("a^ɪ", "I"),
    ("a^ʊ", "W"),
    ("d^z", "ʣ"),
    ("d^ʒ", "ʤ"),
    ("e^ɪ", "A"),
    ("o^ʊ", "O"),
    ("ə^ʊ", "Q"),
    ("s^s", "S"),
    ("t^s", "ʦ"),
    ("t^ʃ", "ʧ"),
    ("ɔ^ɪ", "Y"),
];

/// And those English alone needs, longest first.
const ENGLISH: &[(&str, &str)] = &[
    ("ʔˌn\u{329}", "tn"),
    ("ʔn\u{329}", "tn"),
    ("ʔn", "tn"),
    ("ə^l", "ᵊl"),
    ("ʔ", "t"),
    ("ɚ", "əɹ"),
    ("r", "ɹ"),
    ("x", "k"),
    ("ç", "k"),
    ("ɐ", "ə"),
    ("ɬ", "l"),
    ("ʲ", ""),
    ("\u{303}", ""),
];

/// eSpeak's IPA as Kokoro's letters, one word of phonemes per word.
pub(crate) fn kokoro_letters(raw: &str, language: Language) -> String {
    // eSpeak breaks its answer into lines as it pleases: they are one phrase.
    let mut phonemes = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let english = matches!(language.letter, 'a' | 'b');
    for (sound, letter) in EVERYWHERE {
        phonemes = phonemes.replace(sound, letter);
    }
    if english {
        for (sound, letter) in ENGLISH {
            phonemes = phonemes.replace(sound, letter);
        }
    }
    phonemes = syllabic(&phonemes);
    match language.letter {
        'a' => {
            for (sound, letter) in [("ɜːɹ", "ɜɹ"), ("ɜː", "ɜɹ"), ("ɪə", "iə"), ("ː", "")]
            {
                phonemes = phonemes.replace(sound, letter);
            }
        }
        'b' => {
            for (sound, letter) in [("e^ə", "ɛː"), ("iə", "ɪə")] {
                phonemes = phonemes.replace(sound, letter);
            }
        }
        _ => {}
    }
    let phonemes = phonemes.replace([TIE, '-'], "");
    if !english {
        return phonemes;
    }
    // eSpeak gives the word "I" no stress; Kokoro learnt it with a light one, and swallows it without.
    phonemes
        .split(' ')
        .map(|word| if word == "I" { "ˌI" } else { word })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A consonant that is a syllable by itself ("n̩") is a small schwa and the consonant.
fn syllabic(phonemes: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(phonemes.len());
    for character in phonemes.chars() {
        if character != '\u{329}' {
            out.push(character);
        } else if let Some(consonant) = out.pop() {
            out.push('ᵊ');
            out.push(consonant);
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
#[path = "phonemes_tests.rs"]
mod tests;
