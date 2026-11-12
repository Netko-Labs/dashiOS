use std::sync::atomic::Ordering;

use serde_json::json;

use super::world::{world, world_with};
use crate::protocol::{Listen, Request, Speak};

fn say(text: &str) -> Request {
    Request::Speak(Speak {
        text: text.into(),
        ..Speak::default()
    })
}

fn spoken(world: &super::world::World, id: u64) -> bool {
    world
        .events_named("spoken")
        .iter()
        .any(|event| event["id"] == id)
}

#[test]
fn sentences_are_said_in_order_with_their_words() {
    let world = world();
    assert_eq!(
        world.ask(say("Hello there. How are you today?")).unwrap(),
        json!({ "id": 1 })
    );
    world.until("it is said", |world| spoken(world, 1));
    let sentences = world.events_named("sentence");
    assert_eq!(sentences.len(), 2);
    assert_eq!(
        sentences[0],
        json!({ "event": "sentence", "id": 1, "index": 0, "text": "Hello there.", "ms": 200,
            "words": [{ "text": "Hello", "start": 0, "end": 100 }, { "text": "there.", "start": 100, "end": 200 }] })
    );
    assert_eq!(
        (sentences[1]["index"].clone(), sentences[1]["ms"].clone()),
        (json!(1), json!(400))
    );
    assert_eq!(
        world.events_named("spoken"),
        vec![json!({ "event": "spoken", "id": 1, "reason": "done" })]
    );
    // Six words, a tenth of a second each, all written, and the speakers left to play out.
    assert_eq!(world.played.samples.load(Ordering::SeqCst), 6 * 2400);
    assert!(world.played.finished.load(Ordering::SeqCst));
    world.until("it is idle", |world| {
        world.states().last().map(String::as_str) == Some("idle")
    });
    assert_eq!(world.states(), vec!["thinking", "speaking", "idle"]);
    // The second sentence was told after the first had played: in step, not ahead.
    let events = world.events();
    let second = events.iter().position(|event| event["index"] == 1).unwrap();
    assert!(second > events.iter().position(|event| event["index"] == 0).unwrap());
}

#[test]
fn the_speakers_open_while_the_first_sentence_is_made_not_after() {
    let world = world();
    world.ask(say("Hello there. How are you today?")).unwrap();
    world.until("it is said", |world| spoken(world, 1));
    // One pair of speakers for the utterance, open before any sentence was asked for.
    assert_eq!(world.played.opened.load(Ordering::SeqCst), 1);
    assert_eq!(*world.played.opened_when_made.lock().unwrap(), vec![1, 1]);
    world.until("it is idle", |world| {
        world.states().last().map(String::as_str) == Some("idle")
    });
    // Open speakers are not sound: the state is `speaking` only once the first sentence plays.
    assert_eq!(world.states(), vec!["thinking", "speaking", "idle"]);
}

#[test]
fn a_long_first_sentence_is_heard_in_two_parts_so_its_first_sound_comes_sooner() {
    let world = world();
    world
        .ask(say(
            "I can't see the weather from this computer, but I can remind you. You asked to call Alex.",
        ))
        .unwrap();
    world.until("it is said", |world| spoken(world, 1));
    let said: Vec<(u64, String, u64)> = world
        .events_named("sentence")
        .iter()
        .map(|event| {
            (
                event["index"].as_u64().unwrap(),
                event["text"].as_str().unwrap().to_owned(),
                event["ms"].as_u64().unwrap(),
            )
        })
        .collect();
    // The first piece is eight words (0.8 s of this fake's sound), not the sentence's thirteen.
    assert_eq!(
        said,
        vec![
            (
                0,
                "I can't see the weather from this computer,".to_owned(),
                800
            ),
            (1, "but I can remind you.".to_owned(), 500),
            (2, "You asked to call Alex.".to_owned(), 500),
        ]
    );
    assert_eq!(world.played.samples.load(Ordering::SeqCst), 18 * 2400);
}

#[test]
fn a_stop_is_at_once() {
    let world = world();
    // Half a second in, the person presses Esc.
    world.played.at.store(12_000, Ordering::SeqCst);
    let service = world.service.clone();
    let sink = world.sink.clone();
    *world.played.hook.lock().unwrap() = Some(Box::new(move || {
        service.handle(1, &sink, Request::SpeakStop).unwrap();
    }));
    world
        .ask(say(
            "One two three four five six seven eight nine ten. And more after that.",
        ))
        .unwrap();
    world.until("it is stopped", |world| spoken(world, 1));
    assert_eq!(
        world.events_named("spoken"),
        vec![json!({ "event": "spoken", "id": 1, "reason": "stopped" })]
    );
    // Nothing was written after the stop, and the speakers were closed, not played out.
    assert_eq!(world.played.samples.load(Ordering::SeqCst), 12_000);
    assert!(world.played.closed.load(Ordering::SeqCst));
    assert!(!world.played.finished.load(Ordering::SeqCst));
    assert_eq!(world.events_named("sentence").len(), 1);
    world.until("it is idle", |world| {
        world.states().last().map(String::as_str) == Some("idle")
    });
}

#[test]
fn a_new_thing_to_say_takes_the_place_of_the_old_unless_queued() {
    let world = world();
    world.played.at.store(2400, Ordering::SeqCst);
    let service = world.service.clone();
    let sink = world.sink.clone();
    *world.played.hook.lock().unwrap() = Some(Box::new(move || {
        service.handle(1, &sink, say("Second.")).unwrap();
        let queued = Speak {
            text: "Third.".into(),
            queue: true,
            ..Speak::default()
        };
        service.handle(1, &sink, Request::Speak(queued)).unwrap();
    }));
    world
        .ask(say("First one is long enough to be cut."))
        .unwrap();
    world.until("all three ended", |world| spoken(world, 3));
    let reasons: Vec<_> = world
        .events_named("spoken")
        .iter()
        .map(|event| (event["id"].clone(), event["reason"].clone()))
        .collect();
    assert_eq!(
        reasons,
        vec![
            (json!(1), json!("stopped")),
            (json!(2), json!("done")),
            (json!(3), json!("done"))
        ]
    );
}

#[test]
fn listening_stops_what_is_being_said() {
    let world = world();
    world.played.at.store(2400, Ordering::SeqCst);
    let service = world.service.clone();
    let sink = world.sink.clone();
    *world.played.hook.lock().unwrap() = Some(Box::new(move || {
        service
            .handle(1, &sink, Request::Listen(Listen::default()))
            .unwrap();
    }));
    world
        .ask(say("The person starts to talk over this sentence."))
        .unwrap();
    world.until("it is stopped", |world| spoken(world, 1));
    assert_eq!(world.events_named("spoken")[0]["reason"], "stopped");
    assert!(world.played.closed.load(Ordering::SeqCst));
    world.ask(Request::ListenCancel).unwrap();
}

#[test]
fn what_cannot_be_said_fails_in_words() {
    let world = world();
    world.ask(say("This will fail.")).unwrap();
    world.until("it failed", |world| spoken(world, 1));
    assert_eq!(
        world.events_named("spoken"),
        vec![
            json!({ "event": "spoken", "id": 1, "reason": "failed", "error": "That can't be said." })
        ]
    );
    assert_eq!(
        world.events_named("error"),
        vec![json!({ "event": "error", "message": "That can't be said." })]
    );
    world.until("it is idle", |world| {
        world.states().last().map(String::as_str) == Some("idle")
    });
    // The speakers opened for it are closed, not left open: nothing was written to them.
    assert_eq!(world.played.opened.load(Ordering::SeqCst), 1);
    assert_eq!(world.played.samples.load(Ordering::SeqCst), 0);
    assert!(!world.played.finished.load(Ordering::SeqCst));
    // It was never `speaking`.
    assert!(!world.states().contains(&"speaking".to_owned()));
    // Nothing to say is said at once, is not an error, and opens no speakers.
    world.ask(say("  ")).unwrap();
    world.until("nothing was said", |world| spoken(world, 2));
    assert_eq!(world.events_named("spoken")[1]["reason"], "done");
    assert_eq!(world.played.opened.load(Ordering::SeqCst), 1);
}

#[test]
fn a_voice_must_exist_and_the_models_be_here() {
    let world = world();
    let nobody = Speak {
        text: "Hi".into(),
        voice: Some("nobody".into()),
        ..Speak::default()
    };
    assert_eq!(
        world.ask(Request::Speak(nobody)).unwrap_err(),
        "There is no voice named nobody."
    );
    let klingon = Speak {
        text: "Hi".into(),
        language: Some("tlh".into()),
        ..Speak::default()
    };
    assert_eq!(
        world.ask(Request::Speak(klingon)).unwrap_err(),
        "Voice can't speak tlh."
    );
    let long = Speak {
        text: "x".repeat(20_001),
        ..Speak::default()
    };
    assert_eq!(
        world.ask(Request::Speak(long)).unwrap_err(),
        "That is too much to say at once."
    );
    let bare = world_with(false, &["false"]);
    let refused = bare.ask(say("Hi")).unwrap_err();
    assert_eq!(
        refused,
        "Voice can't speak yet: its speaking models are not on this computer."
    );
}
