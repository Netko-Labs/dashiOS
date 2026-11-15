use std::collections::BTreeMap;

use super::*;

const ANSWER: &str =
    "I found it. Está en la carpeta de descargas. Do you want me to open it? Dime si quieres.";

fn said(params: &Speak) -> Vec<(String, String, Option<String>)> {
    let (lines, _) = lines(params).unwrap();
    lines
        .into_iter()
        .map(|line| (line.text, line.voice, line.tag))
        .collect()
}

fn voices_of(params: &Speak) -> Vec<String> {
    said(params)
        .into_iter()
        .map(|(_, voice, _)| voice)
        .collect()
}

fn text(text: &str) -> Speak {
    Speak {
        text: text.into(),
        ..Speak::default()
    }
}

#[test]
fn each_sentence_is_said_by_a_voice_of_its_own_language() {
    assert_eq!(
        voices_of(&text(ANSWER)),
        vec!["af_heart", "ef_dora", "af_heart", "ef_dora"]
    );
    let george = Speak {
        voice: Some("bm_george".into()),
        ..text(ANSWER)
    };
    assert_eq!(
        voices_of(&george),
        vec!["bm_george", "em_alex", "bm_george", "em_alex"]
    );
    // A Spanish voice asked for: its English pair says the English.
    let dora = Speak {
        voice: Some("ef_dora".into()),
        ..text(ANSWER)
    };
    assert_eq!(
        voices_of(&dora),
        vec!["af_heart", "ef_dora", "af_heart", "ef_dora"]
    );
}

#[test]
fn the_voices_named_say_their_languages_and_carry_their_region() {
    let voices: BTreeMap<String, String> = [("es-CO".to_owned(), "em_alex".to_owned())].into();
    let params = Speak {
        voices: Some(voices),
        ..text("Okay. Son $20.000. Done.")
    };
    assert_eq!(
        said(&params),
        vec![
            ("Okay.".into(), "af_heart".into(), None),
            (
                "Son $20.000.".into(),
                "em_alex".into(),
                Some("es-CO".into())
            ),
            ("Done.".into(), "af_heart".into(), None),
        ]
    );
}

#[test]
fn off_everything_is_said_by_the_one_voice_as_before() {
    let one = Speak {
        by_language: Some(false),
        ..text(ANSWER)
    };
    assert_eq!(voices_of(&one), vec!["af_heart"; 4]);
    let named = Speak {
        by_language: Some(false),
        voice: Some("bm_george".into()),
        language: Some("es".into()),
        ..text(ANSWER)
    };
    assert_eq!(voices_of(&named), vec!["bm_george"; 4]);
    assert!(said(&named).iter().all(|(_, _, tag)| tag.is_none()));
}

#[test]
fn a_language_named_for_all_of_it_is_not_second_guessed() {
    let spanish = Speak {
        language: Some("es-MX".into()),
        ..text("OK. Helium. I found it.")
    };
    // No voice named: the language's first, as it always was.
    assert_eq!(voices_of(&spanish), vec!["ef_dora"; 3]);
    assert!(
        said(&spanish)
            .iter()
            .all(|(_, _, tag)| tag.as_deref() == Some("es-MX"))
    );
    // A voice of another language named with it: its pair says it.
    let george = Speak {
        voice: Some("bm_george".into()),
        language: Some("es".into()),
        ..text("Hola. Ya está.")
    };
    assert_eq!(voices_of(&george), vec!["em_alex"; 2]);
    let japanese = Speak {
        language: Some("ja".into()),
        ..text("Hello.")
    };
    assert_eq!(lines(&japanese).unwrap_err(), "Voice can't speak ja.");
}

#[test]
fn each_stretch_may_name_its_language_and_the_rest_is_told() {
    let stretch = |text: &str, language: Option<&str>| Stretch {
        text: text.into(),
        language: language.map(str::to_owned),
    };
    let params = Speak {
        parts: Some(vec![
            stretch("Helium. YouTube.", Some("es")),
            stretch("OK. It is open now. Listo.", None),
            stretch("Bonjour.", Some("fr")),
        ]),
        ..Speak::default()
    };
    assert_eq!(
        voices_of(&params),
        // "OK." keeps the Spanish before it; French has no role, so Heart's pair says it.
        vec![
            "ef_dora", "ef_dora", "ef_dora", "af_heart", "ef_dora", "ff_siwis"
        ]
    );
}

#[test]
fn a_first_sentence_with_no_evidence_is_in_the_conversations_language() {
    let hinted = Speak {
        hint: Some("es-CO".into()),
        ..text("OK. Alex Kim. It is open now.")
    };
    assert_eq!(voices_of(&hinted), vec!["ef_dora", "ef_dora", "af_heart"]);
    assert_eq!(voices_of(&text("OK. Alex Kim.")), vec!["af_heart"; 2]);
    // A hint for a language that may not be spoken is no hint.
    let french = Speak {
        hint: Some("fr".into()),
        ..text("OK.")
    };
    assert_eq!(voices_of(&french), vec!["af_heart"]);
}

#[test]
fn a_long_first_sentence_is_two_lines_in_one_voice() {
    let long = "No puedo ver el clima desde este computador, pero te lo puedo recordar. Done.";
    let (said, cut) = lines(&text(long)).unwrap();
    assert!(cut);
    assert_eq!(
        said.iter()
            .map(|line| (line.text.as_str(), line.voice.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("No puedo ver el clima desde este computador,", "ef_dora"),
            ("pero te lo puedo recordar.", "ef_dora"),
            ("Done.", "af_heart"),
        ]
    );
    assert_eq!(lines(&text("")).unwrap(), (Vec::new(), false));
}
