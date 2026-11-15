use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::world::{World, world};
use crate::protocol::{Listen, Request, Speak};

const ANSWER: &str =
    "I found it. Está en la carpeta de descargas. Do you want me to open it? Dime si quieres.";

fn spoken(world: &World, id: u64) -> bool {
    world
        .events_named("spoken")
        .iter()
        .any(|event| event["id"] == id)
}

/// Each sentence's voice and language, as its event told them.
fn told(world: &World) -> Vec<(Value, Value)> {
    world
        .events_named("sentence")
        .iter()
        .map(|event| (event["voice"].clone(), event["language"].clone()))
        .collect()
}

#[test]
fn each_sentence_is_said_in_a_voice_of_its_own_language() {
    let world = world();
    let voices: BTreeMap<String, String> = [("es-CO".to_owned(), "ef_dora".to_owned())].into();
    let params = Speak {
        text: ANSWER.into(),
        voice: Some("af_heart".into()),
        voices: Some(voices),
        ..Speak::default()
    };
    world.ask(Request::Speak(params)).unwrap();
    world.until("it is said", |world| spoken(world, 1));
    assert_eq!(
        told(&world),
        vec![
            (json!("af_heart"), json!("en-US")),
            (json!("ef_dora"), json!("es-419")),
            (json!("af_heart"), json!("en-US")),
            (json!("ef_dora"), json!("es-419")),
        ]
    );
    // The model was asked for each in its voice, the Spanish ones read as the region says.
    let asked = world.played.voices.lock().unwrap().clone();
    assert_eq!(asked[1], ("ef_dora".into(), Some("es-CO".into())));
    assert_eq!(asked[2], ("af_heart".into(), None));
    assert_eq!(world.events_named("spoken")[0]["reason"], "done");
}

#[test]
fn off_everything_is_said_by_the_one_voice() {
    let world = world();
    let params = Speak {
        text: ANSWER.into(),
        by_language: Some(false),
        ..Speak::default()
    };
    world.ask(Request::Speak(params)).unwrap();
    world.until("it is said", |world| spoken(world, 1));
    assert_eq!(told(&world), vec![(json!("af_heart"), json!("en-US")); 4]);
}

#[test]
fn a_voice_that_is_not_here_stops_the_whole_utterance_before_any_sound() {
    let world = world();
    let voices: BTreeMap<String, String> = [("es".to_owned(), "ef_nobody".to_owned())].into();
    let params = Speak {
        text: ANSWER.into(),
        voices: Some(voices),
        ..Speak::default()
    };
    // The fake has every voice but "nobody"; the real one looks for the file.
    assert!(world.ask(Request::Speak(params)).is_ok());
    let wrong: BTreeMap<String, String> = [("es".to_owned(), "bm_george".to_owned())].into();
    let params = Speak {
        text: ANSWER.into(),
        voices: Some(wrong),
        ..Speak::default()
    };
    assert_eq!(
        world.ask(Request::Speak(params)).unwrap_err(),
        "bm_george is not a voice that speaks Spanish."
    );
}

#[test]
fn what_was_heard_comes_with_its_language_when_the_words_tell_it() {
    let world = world();
    world.counter.lock().unwrap().hears = Some("abre Helium y ve a YouTube".into());
    world.ask(Request::Listen(Listen::default())).unwrap();
    world.feed(20, true);
    world.until("the frames are read", |world| {
        world.events_named("level").len() >= 20
    });
    world.feed(4, true);
    let heard = world.ask(Request::ListenStop).unwrap();
    assert_eq!(heard["language"], "es");
    assert_eq!(world.events_named("heard")[0]["language"], "es");
}
