//! Text to Kokoro's phonemes.
//!
//! The pronunciation comes from eSpeak NG (GPL-3.0-or-later), run as its own
//! program (`espeak-ng --ipa`), never linked: Dashi only reads what it
//! prints (docs/conventions.md, "Licenses"). This module turns that IPA into
//! the symbols Kokoro was trained on (one letter per diphthong and
//! affricate, American English without length marks) and then into
//! Kokoro's token ids.

use std::{collections::HashMap, process::Command};

/// Kokoro takes 512 tokens with its two pads; keep each piece well under.
pub(crate) const MAX_PHONEMES: usize = 400;

/// The eSpeak voice for a language Dashi speaks.
pub(crate) fn espeak_voice(lang: &str) -> &'static str {
    match lang {
        "es" => "es-419",
        _ => "en-us",
    }
}

/// Sentences to speak one at a time (each becomes a caption).
pub(crate) fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\n' {
            push_trimmed(&mut out, &mut current);
            continue;
        }
        current.push(c);
        let ends = matches!(c, '.' | '!' | '?' | '…');
        if ends && chars.peek().is_none_or(|next| next.is_whitespace()) {
            push_trimmed(&mut out, &mut current);
        }
    }
    push_trimmed(&mut out, &mut current);
    out
}

fn push_trimmed(out: &mut Vec<String>, current: &mut String) {
    let trimmed = current.trim();
    if trimmed.chars().any(char::is_alphanumeric) {
        out.push(trimmed.to_string());
    }
    current.clear();
}

/// A sentence split at its punctuation: each run of words and the mark after it.
pub(crate) fn clauses(sentence: &str) -> Vec<(String, Option<char>)> {
    let mut out = Vec::new();
    let mut words = String::new();
    for c in sentence.chars() {
        if matches!(c, ',' | '.' | ';' | ':' | '!' | '?' | '—' | '…') {
            out.push((words.trim().to_string(), Some(c)));
            words.clear();
        } else if matches!(c, '¿' | '¡' | '"' | '“' | '”' | '(' | ')') {
            words.push(' ');
        } else {
            words.push(c);
        }
    }
    if !words.trim().is_empty() {
        out.push((words.trim().to_string(), None));
    }
    out.retain(|(words, mark)| !words.is_empty() || mark.is_some());
    out
}

/// eSpeak's IPA (with `^` ties) as Kokoro's symbols.
pub(crate) fn from_espeak(ipa: &str, lang: &str) -> String {
    let mut text = ipa.split_whitespace().collect::<Vec<_>>().join(" ");
    // Tied pairs that are one symbol to Kokoro.
    for (from, to) in [
        ("a^ɪ", "I"),
        ("a^ʊ", "W"),
        ("e^ɪ", "A"),
        ("o^ʊ", "O"),
        ("ɔ^ɪ", "Y"),
        ("ə^ʊ", "Q"),
        ("d^ʒ", "ʤ"),
        ("t^ʃ", "ʧ"),
        ("t^s", "ʦ"),
        ("d^z", "ʣ"),
    ] {
        text = text.replace(from, to);
    }
    text = text.replace('^', "").replace('g', "ɡ");
    if lang == "en" {
        for (from, to) in [
            ("ʔn̩", "tᵊn"),
            ("n̩", "ᵊn"),
            ("ʔ", "t"),
            ("ɚ", "əɹ"),
            ("ɝ", "ɜɹ"),
            ("ɜː", "ɜɹ"),
            ("ɾ", "T"),
            ("r", "ɹ"),
            ("ɐ", "ə"),
            ("ᵻ", "ɪ"),
            ("x", "k"),
            ("ç", "k"),
            ("ɬ", "l"),
            ("ː", ""),
        ] {
            text = text.replace(from, to);
        }
    }
    text
}

/// Run eSpeak NG on words, for its IPA.
pub(crate) fn espeak(words: &str, lang: &str) -> Result<String, String> {
    if words.trim().is_empty() {
        return Ok(String::new());
    }
    let output = Command::new("espeak-ng")
        .args(["-q", "--ipa", "--tie=^", "-v", espeak_voice(lang), "--"])
        .arg(words)
        .output()
        .map_err(|error| format!("espeak-ng isn't installed ({error})"))?;
    if !output.status.success() {
        return Err(format!(
            "espeak-ng failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A sentence as Kokoro's phonemes, through eSpeak.
pub(crate) fn phonemize(sentence: &str, lang: &str) -> Result<String, String> {
    let mut out = String::new();
    for (words, mark) in clauses(sentence) {
        let ipa = espeak(&words, lang)?;
        let symbols = from_espeak(&ipa, lang);
        if !symbols.is_empty() {
            if !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            out.push_str(&symbols);
        }
        if let Some(mark) = mark {
            out.push(mark);
        }
    }
    Ok(out.trim().to_string())
}

/// Kokoro's vocabulary, from its tokenizer.json (`model.vocab`: symbol to id).
pub(crate) fn parse_vocab(json: &str) -> Result<HashMap<char, i64>, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|error| format!("tokenizer.json: {error}"))?;
    let vocab = value
        .pointer("/model/vocab")
        .and_then(|vocab| vocab.as_object())
        .ok_or("tokenizer.json has no model.vocab")?;
    let mut out = HashMap::new();
    for (symbol, id) in vocab {
        let mut chars = symbol.chars();
        if let (Some(c), None, Some(id)) = (chars.next(), chars.next(), id.as_i64()) {
            out.insert(c, id);
        }
    }
    Ok(out)
}

/// Phonemes to ids; symbols Kokoro doesn't know are left out.
pub(crate) fn tokens(phonemes: &str, vocab: &HashMap<char, i64>) -> Vec<i64> {
    phonemes
        .chars()
        .filter_map(|c| vocab.get(&c).copied())
        .collect()
}

/// Long phoneme runs split at spaces so each fits Kokoro.
pub(crate) fn pieces(phonemes: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for word in phonemes.split(' ') {
        if !current.is_empty() && current.chars().count() + word.chars().count() + 1 > MAX_PHONEMES
        {
            out.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.extend(word.chars().take(MAX_PHONEMES));
    }
    if !current.trim().is_empty() {
        out.push(current);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentences_split_at_their_ends() {
        assert_eq!(
            sentences("Let's apply. I'll do the form!  Sound good?\nGo"),
            vec!["Let's apply.", "I'll do the form!", "Sound good?", "Go"]
        );
        assert_eq!(
            sentences("Version 0.5 is out."),
            vec!["Version 0.5 is out."]
        );
        assert_eq!(sentences("¿Lo envío? Sí."), vec!["¿Lo envío?", "Sí."]);
        assert!(sentences(" ... ").is_empty());
    }

    #[test]
    fn clauses_keep_their_marks() {
        assert_eq!(
            clauses("¿Hola, qué tal?"),
            vec![
                ("Hola".to_string(), Some(',')),
                ("qué tal".to_string(), Some('?'))
            ]
        );
        assert_eq!(clauses("Go"), vec![("Go".to_string(), None)]);
    }

    #[test]
    fn english_ipa_becomes_kokoro_symbols() {
        assert_eq!(from_espeak("həlˈo^ʊ\n", "en"), "həlˈO");
        assert_eq!(from_espeak("a^ɪm dˈæʃi", "en"), "Im dˈæʃi");
        assert_eq!(from_espeak("bˈʌɾɚ", "en"), "bˈʌTəɹ");
        assert_eq!(from_espeak("bˈɜːd", "en"), "bˈɜɹd");
        assert_eq!(from_espeak("θɹˈiː ˈæpə^lz", "en"), "θɹˈi ˈæpəlz");
        assert_eq!(from_espeak("bˈʌʔn̩", "en"), "bˈʌtᵊn");
        assert_eq!(from_espeak("d^ʒˈʌst t^ʃˈɛk", "en"), "ʤˈʌst ʧˈɛk");
    }

    #[test]
    fn spanish_keeps_its_sounds() {
        assert_eq!(from_espeak("roðɾˈiɣo ˈiso", "es"), "roðɾˈiɣo ˈiso");
        assert_eq!(from_espeak("sˈo^ɪ", "es"), "sˈo\u{26a}");
        assert_eq!(from_espeak("bwˈenos ˈdi^as", "es"), "bwˈenos ˈdias");
        assert_eq!(espeak_voice("es"), "es-419");
        assert_eq!(espeak_voice("fr"), "en-us");
    }

    #[test]
    fn vocab_and_tokens() {
        let vocab = parse_vocab(
            r#"{"model":{"vocab":{"$":0,",":3,"h":50,"ə":83,"l":54,"O":31,"ˈ":156,"ab":7}}}"#,
        )
        .unwrap();
        assert_eq!(vocab.len(), 7);
        assert_eq!(tokens("həlˈO, ¿", &vocab), vec![50, 83, 54, 156, 31, 3]);
        assert!(parse_vocab("{}").is_err());
    }

    #[test]
    fn long_runs_are_split_at_spaces() {
        let word = "a".repeat(150);
        let text = [word.as_str(); 5].join(" ");
        let out = pieces(&text);
        assert_eq!(out.len(), 3);
        assert!(
            out.iter()
                .all(|piece| piece.chars().count() <= MAX_PHONEMES)
        );
        assert_eq!(pieces(&"b".repeat(900))[0].chars().count(), MAX_PHONEMES);
    }
}
