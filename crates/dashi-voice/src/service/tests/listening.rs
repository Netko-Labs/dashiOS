use std::sync::atomic::Ordering;

use serde_json::json;

use super::world::{world, world_with};
use crate::protocol::{Listen, Request, Until};

#[test]
fn a_held_key_is_heard_when_it_is_let_go() {
    let world = world();
    world
        .ask(Request::Listen(Listen {
            language: Some("es".into()),
            ..Listen::default()
        }))
        .unwrap();
    world.feed(10, false);
    world.feed(20, true);
    world.until("the frames are read", |world| {
        world.events_named("level").len() >= 30
    });
    // The stop reads four more frames, then the model is asked.
    world.feed(4, true);
    let heard = world.ask(Request::ListenStop).unwrap();
    // 20 + 4 frames of speech and the 7 before them: the silence before was dropped.
    assert_eq!(heard, json!({ "text": "31 frames", "speech_ms": 992 }));
    assert_eq!(world.states(), vec!["listening", "thinking", "idle"]);
    assert_eq!(
        world.events_named("heard"),
        vec![json!({ "event": "heard", "text": "31 frames", "speech_ms": 992 })]
    );
    let levels = world.events_named("level");
    assert_eq!(levels[0]["level"], 0.0);
    assert!(levels[29]["level"].as_f64().unwrap() > 0.8);
    // The model was told the language, and the microphone is closed.
    assert_eq!(
        world
            .counter
            .lock()
            .unwrap()
            .asked
            .last()
            .unwrap()
            .1
            .as_deref(),
        Some("es")
    );
    assert_eq!(
        world.ask(Request::ListenStop).unwrap_err(),
        "Voice is not listening."
    );
}

#[test]
fn a_listen_can_end_itself_when_the_person_goes_quiet() {
    let world = world();
    let params = Listen {
        until: Until::Silence,
        quiet_ms: Some(320),
        partials: Some(false),
        ..Listen::default()
    };
    world.ask(Request::Listen(params)).unwrap();
    // Quiet before any speech ends nothing.
    world.feed(30, false);
    world.feed(10, true);
    world.feed(10, false);
    world.until("it is heard", |world| {
        !world.events_named("heard").is_empty()
    });
    assert_eq!(world.events_named("heard")[0]["text"], "27 frames");
    world.until("it is idle", |world| {
        world.states().last().map(String::as_str) == Some("idle")
    });
    assert_eq!(
        world.ask(Request::ListenStop).unwrap_err(),
        "Voice is not listening."
    );
    assert!(world.events_named("partial").is_empty());
}

#[test]
fn nothing_said_is_no_words_and_the_model_is_not_asked() {
    let world = world();
    world
        .ask(Request::Listen(Listen {
            partials: Some(false),
            ..Listen::default()
        }))
        .unwrap();
    world.feed(40, false);
    world.until("the frames are read", |world| {
        world.events_named("level").len() >= 36
    });
    assert_eq!(
        world.ask(Request::ListenStop).unwrap(),
        json!({ "text": "", "speech_ms": 0 })
    );
    assert!(world.counter.lock().unwrap().asked.is_empty());
}

#[test]
fn words_come_as_they_are_said() {
    let world = world();
    world.ask(Request::Listen(Listen::default())).unwrap();
    world.feed(60, true);
    world.until("a partial comes", |world| {
        !world.events_named("partial").is_empty()
    });
    let partial = &world.events_named("partial")[0];
    assert!(partial["text"].as_str().unwrap().ends_with(" frames"));
    world.ask(Request::ListenCancel).unwrap();
}

#[test]
fn a_listen_ends_with_the_connection_that_asked() {
    let world = world();
    world
        .ask(Request::Listen(Listen {
            partials: Some(false),
            ..Listen::default()
        }))
        .unwrap();
    world.feed(20, true);
    // Another connection going away changes nothing.
    world.service.hang_up(2);
    assert!(!world.microphone_closed.load(Ordering::SeqCst));
    world.service.hang_up(1);
    assert!(world.microphone_closed.load(Ordering::SeqCst));
    // The listen is dropped: no words are worked out.
    world.until("the listen is gone", |world| {
        world.ask(Request::ListenStop).is_err()
    });
    assert!(world.counter.lock().unwrap().asked.is_empty());
}

#[test]
fn one_listen_at_a_time_and_only_with_models() {
    let world = world();
    world.ask(Request::Listen(Listen::default())).unwrap();
    assert_eq!(
        world.ask(Request::Listen(Listen::default())).unwrap_err(),
        "Voice is already listening."
    );
    world.ask(Request::ListenCancel).unwrap();
    let unheard = world.ask(Request::Listen(Listen {
        language: Some("tlh".into()),
        ..Listen::default()
    }));
    assert_eq!(unheard.unwrap_err(), "Voice can't hear tlh yet.");
    let bare = world_with(false, &["false"]);
    let refused = bare.ask(Request::Listen(Listen::default())).unwrap_err();
    assert_eq!(
        refused,
        "Voice can't listen yet: its listening models are not on this computer."
    );
    assert!(bare.states().is_empty());
}

#[test]
fn a_microphone_that_ends_by_itself_still_gives_its_words() {
    let mut world = world();
    world
        .ask(Request::Listen(Listen {
            partials: Some(false),
            ..Listen::default()
        }))
        .unwrap();
    world.feed(12, true);
    world.microphone = None;
    world.until("it is heard", |world| {
        !world.events_named("heard").is_empty()
    });
    assert_eq!(world.events_named("heard")[0]["text"], "12 frames");
}
