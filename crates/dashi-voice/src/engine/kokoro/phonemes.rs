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
mod tests {
    use super::*;

    const US: Language = LANGUAGES[0];
    const UK: Language = LANGUAGES[1];
    const SPANISH: Language = LANGUAGES[2];

    #[test]
    fn american_sounds_become_kokoros_letters() {
        assert_eq!(
            kokoro_letters("həlˈo^ʊ ðˈɛ^ɹ\n hˈa^ʊ ɑː^ɹ juː", US),
            "həlˈO ðˈɛɹ hˈW ɑɹ ju"
        );
        assert_eq!(
            kokoro_letters("d^ʒˈʌmps ˌo^ʊvɚ ðə lˈe^ɪzi", US),
            "ʤˈʌmps ˌOvəɹ ðə lˈAzi"
        );
        assert_eq!(kokoro_letters("bˈʌʔn\u{329}", US), "bˈʌtn");
        assert_eq!(kokoro_letters("bˈɑːɾə^l wˈɜːd", US), "bˈɑɾᵊl wˈɜɹd");
        assert_eq!(kokoro_letters("ɹˈɪðm\u{329}", US), "ɹˈɪðᵊm");
        assert_eq!(kokoro_letters("a^ɪ kæn hˈa^ɪ", US), "ˌI kæn hˈI");
    }

    #[test]
    fn british_keeps_its_long_vowels() {
        assert_eq!(kokoro_letters("ɡˈə^ʊ ðˈe^ə fˈɑːðə", UK), "ɡˈQ ðˈɛː fˈɑːðə");
    }

    #[test]
    fn other_languages_keep_their_own_sounds() {
        assert_eq!(
            kokoro_letters("kˈomo estˈas\nrˈapiðo", SPANISH),
            "kˈomo estˈas rˈapiðo"
        );
        assert_eq!(kokoro_letters("mˈut^ʃo", SPANISH), "mˈuʧo");
    }

    #[test]
    fn a_voice_names_its_language() {
        assert_eq!(of_voice("af_heart").map(|l| l.code), Some("en-US"));
        assert_eq!(of_voice("bm_george").map(|l| l.espeak), Some("en-gb"));
        assert_eq!(of_voice("pf_dora").map(|l| l.code), Some("pt-BR"));
        // Japanese and Mandarin voices exist, but nothing here can read for them.
        assert_eq!(of_voice("jf_alpha"), None);
        assert_eq!(of_voice(""), None);
    }
}
