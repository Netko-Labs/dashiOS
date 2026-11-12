use super::super::phonemes::LANGUAGES;
use super::*;

/// Says each word as itself, lower case; "&" joins the two words around it, as eSpeak sometimes does.
struct Echo {
    asked: Vec<String>,
}

impl Phonemizer for Echo {
    fn phonemes(&mut self, phrase: &str, _language: Language) -> Result<String, String> {
        self.asked.push(phrase.to_owned());
        Ok(phrase.to_lowercase().replace(" and ", "n"))
    }
}

fn plan_of(sentence: &str) -> (Vec<Part>, Vec<String>) {
    let mut echo = Echo { asked: Vec::new() };
    let parts = plan(sentence, LANGUAGES[0], &mut echo).unwrap();
    (parts, echo.asked)
}

fn spelled(tokens: &[i64]) -> String {
    let alphabet = "abcdefhijklmnopqrstuvwxyz ,.!?—“”()";
    tokens
        .iter()
        .map(|id| {
            alphabet
                .chars()
                .find(|c| vocab::id(*c) == Some(*id))
                .unwrap_or('#')
        })
        .collect()
}

#[test]
fn words_keep_their_marks_and_their_places() {
    let (parts, asked) = plan_of("Hello there, friend!");
    // A phrase is said up to each pause, never with its marks.
    assert_eq!(asked, vec!["Hello there", "friend"]);
    assert_eq!(parts.len(), 1);
    assert_eq!(spelled(&parts[0].tokens), "hello there, friend!");
    let words: Vec<(&str, String)> = parts[0]
        .words
        .iter()
        .map(|span| {
            (
                span.text.as_str(),
                spelled(&parts[0].tokens[span.first..span.end]),
            )
        })
        .collect();
    assert_eq!(
        words,
        vec![
            ("Hello", "hello".into()),
            ("there,", "there,".into()),
            ("friend!", "friend!".into())
        ]
    );
}

#[test]
fn marks_kokoro_does_not_know_are_translated_or_dropped() {
    let (parts, asked) = plan_of("«Can't» stop – *now*");
    assert_eq!(asked, vec!["Can't", "stop", "now"]);
    assert_eq!(spelled(&parts[0].tokens), "“cant” stop — now");
    // A mark alone is a word of its own on screen, with only its pause to say.
    assert_eq!(parts[0].words[2].text, "–");
}

#[test]
fn a_phrase_espeak_joined_is_shared_by_length() {
    let (parts, _) = plan_of("salt and pepper");
    // Two words came back for three: the phonemes "saltnpepper" are shared 4:3:6.
    let words: Vec<String> = parts[0]
        .words
        .iter()
        .map(|span| spelled(&parts[0].tokens[span.first..span.end]))
        .collect();
    assert_eq!(words, vec!["sal", "tn", "pepper"]);
    assert_eq!(parts[0].words[1].text, "and");
}

fn atom(text: &str, length: usize, pause: bool) -> Atom {
    Atom {
        text: text.into(),
        tokens: vec![43; length],
        pause,
    }
}

#[test]
fn a_long_sentence_is_cut_at_a_pause() {
    let atoms = vec![
        atom("a", 4, false),
        atom("b,", 4, true),
        atom("c", 4, false),
        atom("d", 4, false),
    ];
    let parts = pack(atoms, 16).unwrap();
    assert_eq!(parts.len(), 2);
    // "a b," is 9 tokens, past half of 16: the cut is there, and "c" starts the next part at 0.
    assert_eq!(parts[0].tokens.len(), 9);
    assert_eq!(parts[0].words.len(), 2);
    assert_eq!((parts[1].words[0].first, parts[1].words[0].end), (0, 4));
    assert_eq!((parts[1].words[1].first, parts[1].words[1].end), (5, 9));
    assert_eq!(parts[1].tokens.len(), 9);
}

#[test]
fn with_no_pause_it_is_cut_between_words() {
    let atoms = vec![
        atom("a", 6, false),
        atom("b", 6, false),
        atom("c", 6, false),
    ];
    let parts = pack(atoms, 14).unwrap();
    assert_eq!(
        parts
            .iter()
            .map(|part| part.words.len())
            .collect::<Vec<_>>(),
        vec![2, 1]
    );
    assert!(pack(vec![atom("x", 20, false)], 14).is_err());
    assert!(pack(Vec::new(), 14).unwrap().is_empty());
}
