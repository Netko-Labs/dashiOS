use std::io::Cursor;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::world::{world, world_with};
use crate::hub::Sink;
use crate::hub::tests::Kept;
use crate::protocol::{Request, Sets};
use crate::server::converse;

#[test]
fn status_and_models_say_what_is_here() {
    let world = world();
    let status = world.ask(Request::Status).unwrap();
    assert_eq!(
        status,
        json!({ "version": "0.8.0", "state": "idle", "listen": false, "speak": false, "whisper": false, "fetching": false })
    );
    let models = world.ask(Request::Models).unwrap();
    let sets = models["sets"].as_array().unwrap();
    assert_eq!(sets.len(), 3);
    assert_eq!(sets[0]["id"], "listen");
    assert_eq!(sets[0]["bytes"], 672_862_728u64);
    assert_eq!(
        (
            sets[0]["have"].clone(),
            sets[0]["installed"].clone(),
            sets[0]["basic"].clone()
        ),
        (json!(0), json!(false), json!(true))
    );
    assert_eq!(sets[2]["basic"], false);
    assert_eq!(models["folder"], json!(world.folder.path()));
}

#[test]
fn a_fetch_tells_its_progress_and_its_end() {
    let script = r#"echo '{"set":"listen","file":"a.onnx","received":10,"bytes":100}'; echo junk; echo '{"set":"speak","file":"b.onnx","received":100,"bytes":100}'; echo '{"done":true,"error":null}'"#;
    let world = world_with(true, &["sh", "-c", script, "fetch"]);
    let started = world.ask(Request::Fetch(Sets::default())).unwrap();
    // The basic sets, whole: nothing of them is here yet.
    assert_eq!(
        started,
        json!({ "bytes": 672_862_728u64 + 334_932_491, "fetching": true })
    );
    world.until("the fetch ends", |world| {
        !world.events_named("models").is_empty()
    });
    assert_eq!(
        world.events_named("fetch"),
        vec![
            json!({ "event": "fetch", "set": "listen", "file": "a.onnx", "received": 10, "bytes": 100, "done": false }),
            json!({ "event": "fetch", "set": "speak", "file": "b.onnx", "received": 100, "bytes": 100, "done": false }),
            json!({ "event": "fetch", "received": 100, "bytes": 100, "done": true }),
        ]
    );
    assert_eq!(world.ask(Request::Status).unwrap()["fetching"], false);
}

#[test]
fn a_fetch_that_fails_or_dies_says_so() {
    let failing = world_with(
        true,
        &[
            "sh",
            "-c",
            r#"echo '{"done":true,"error":"This computer is offline."}'"#,
            "fetch",
        ],
    );
    failing
        .ask(Request::Fetch(Sets {
            sets: Some(vec!["whisper".into()]),
        }))
        .unwrap();
    failing.until("the fetch ends", |world| {
        !world.events_named("models").is_empty()
    });
    assert_eq!(
        failing.events_named("fetch")[0]["error"],
        "This computer is offline."
    );
    let dying = world_with(true, &["sh", "-c", "exit 1", "fetch"]);
    dying.ask(Request::Fetch(Sets::default())).unwrap();
    dying.until("the fetch ends", |world| {
        !world.events_named("models").is_empty()
    });
    assert_eq!(
        dying.events_named("fetch")[0]["error"],
        "The fetch stopped before it was done."
    );
    let unknown = dying.ask(Request::Fetch(Sets {
        sets: Some(vec!["nope".into()]),
    }));
    assert_eq!(unknown.unwrap_err(), "There are no models named nope.");
}

#[test]
fn a_fetch_can_be_cancelled_and_only_one_runs() {
    let world = world_with(true, &["sh", "-c", "exec sleep 30", "fetch"]);
    world.ask(Request::Fetch(Sets::default())).unwrap();
    assert_eq!(
        world.ask(Request::Fetch(Sets::default())).unwrap_err(),
        "Models are already being fetched."
    );
    assert_eq!(
        world.ask(Request::Remove(Sets::default())).unwrap_err(),
        "Models are being fetched. Cancel that first."
    );
    world.ask(Request::FetchCancel).unwrap();
    world.until("the fetch ends", |world| {
        !world.events_named("models").is_empty()
    });
    assert_eq!(
        world.events_named("fetch")[0]["error"],
        "The fetch stopped before it was done."
    );
}

#[test]
fn removed_models_are_gone_from_disk_and_memory() {
    let world = world();
    let kept = world.folder.path().join("speak/voices");
    std::fs::create_dir_all(&kept).unwrap();
    std::fs::write(kept.join("af_heart.bin"), "x").unwrap();
    world
        .ask(Request::Remove(Sets {
            sets: Some(vec!["speak".into()]),
        }))
        .unwrap();
    assert!(!world.folder.path().join("speak").exists());
    assert_eq!(world.events_named("models").len(), 1);
}

#[test]
fn a_connection_gets_one_reply_per_request_in_lines() {
    let world = world();
    let kept = Arc::new(Mutex::new(Kept::default()));
    let sink: Sink = kept.clone();
    let lines = "{\"id\":1,\"method\":\"status\"}\n\n{\"id\":2,\"method\":\"dance\"}\nnot json\n{\"id\":3,\"method\":\"voices\"}\n";
    converse(
        &world.service,
        9,
        &mut Cursor::new(lines.as_bytes().to_vec()),
        &sink,
    );
    let written = String::from_utf8(kept.lock().unwrap().bytes.clone()).unwrap();
    let replies: Vec<Value> = written
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 4);
    assert_eq!(replies[0]["result"]["state"], "idle");
    assert_eq!(
        replies[1],
        json!({ "id": 2, "error": "unknown method dance" })
    );
    assert_eq!(replies[2]["id"], Value::Null);
    assert_eq!(replies[3]["result"]["default"], "af_heart");
}
