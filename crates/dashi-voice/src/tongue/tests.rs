//! Whole sentences in one language, as an assistant answers and a person asks.

use super::Tongue::{self, English, Spanish};
use super::{evidence, tell};

const BOTH: [Tongue; 2] = [English, Spanish];

pub(super) fn all_are(tongue: Tongue, among: &[Tongue], sentences: &[&str]) {
    for sentence in sentences {
        assert_eq!(evidence(sentence, among), Some(tongue), "{sentence}");
    }
}

#[test]
fn english_sentences_are_english() {
    all_are(
        English,
        &BOTH,
        &[
            "I found it.",
            "Do you want me to open it?",
            "It's ten past four.",
            "You have two meetings left.",
            "Done.",
            "The file is in your downloads folder.",
            "I can't see the weather from this computer.",
            "Opening Helium now.",
            "There are three windows on this desktop.",
            "Which one should I close?",
            "Sorry, I didn't catch that.",
            "Your battery is at 40 percent.",
            "I sent the message to Alex.",
            "What would you like to do next?",
            "That didn't work, so I tried again.",
            "Turn the volume down a little.",
            "Remind me to call the bank tomorrow.",
            "Nothing is playing right now.",
            "Here's what I found on the page.",
            "We're still waiting for the download.",
        ],
    );
}

#[test]
fn spanish_sentences_are_spanish() {
    all_are(
        Spanish,
        &BOTH,
        &[
            "Está en la carpeta de descargas.",
            "Dime si quieres.",
            "Lo encontré.",
            "¿Quieres que lo abra?",
            "Son las cuatro y diez.",
            "Te quedan dos reuniones.",
            "Listo.",
            "El archivo está en tu carpeta de descargas.",
            "No puedo ver el clima desde este computador.",
            "Ya lo abrí.",
            "Hay tres ventanas en este escritorio.",
            "¿Cuál cierro?",
            "Perdón, no te entendí.",
            "La batería está al 40 por ciento.",
            "Le mandé el mensaje a Alex.",
            "¿Qué quieres hacer ahora?",
            "Eso no funcionó, así que lo intenté otra vez.",
            "Baja un poco el volumen.",
            "Recuérdame llamar al banco mañana.",
            "No hay nada sonando ahora.",
        ],
    );
}

#[test]
fn a_sentence_with_no_evidence_tells_nothing() {
    for sentence in [
        "OK.",
        "Alex Kim.",
        "42.",
        "No.",
        "Helium.",
        "YouTube, GitHub.",
        "…",
    ] {
        assert_eq!(evidence(sentence, &BOTH), None, "{sentence}");
    }
}

fn told(text: &[&str], first: Tongue) -> Vec<Tongue> {
    let sentences: Vec<String> = text.iter().map(|each| (*each).to_owned()).collect();
    tell(&sentences, &BOTH, first)
}

#[test]
fn the_owners_answer_changes_voice_at_each_sentence() {
    assert_eq!(
        told(
            &[
                "I found it.",
                "Está en la carpeta de descargas.",
                "Do you want me to open it?",
                "Dime si quieres.",
            ],
            English
        ),
        vec![English, Spanish, English, Spanish]
    );
}

#[test]
fn a_short_sentence_keeps_the_language_before_it_and_the_first_the_conversations() {
    assert_eq!(
        told(&["OK.", "Ya lo abrí.", "Alex Kim.", "42."], English),
        vec![English, Spanish, Spanish, Spanish]
    );
    assert_eq!(told(&["OK.", "No."], Spanish), vec![Spanish, Spanish]);
    assert_eq!(
        told(&["Helium.", "It's open now.", "OK."], Spanish),
        vec![Spanish, English, English]
    );
}

#[test]
fn only_the_languages_that_may_be_spoken_are_told() {
    assert_eq!(evidence("Está en la carpeta.", &[English]), None);
    assert_eq!(
        told(&["Está en la carpeta."], English),
        vec![Spanish],
        "among both"
    );
    let one: Vec<String> = vec!["Está en la carpeta.".into()];
    assert_eq!(tell(&one, &[English], English), vec![English]);
    assert_eq!(Tongue::of("es-CO"), Some(Spanish));
    assert_eq!(Tongue::of("EN_us"), Some(English));
    assert_eq!(Tongue::of("ja"), None);
}
