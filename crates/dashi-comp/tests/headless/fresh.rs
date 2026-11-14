//! A window's picture after the agent's own input waits for the window's next frame, for 250 ms at most.

use std::{
    io::{BufRead, Write},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::fixtures::movable_window;
use crate::support::compositor::{Compositor, Ipc};

/// `session/agent_fresh.rs`'s bound.
const FRESH_WAIT: Duration = Duration::from_millis(250);

fn typed(ipc: &mut Ipc, window: u64) -> Instant {
    let keys = json!({ "window": window, "label": "Test", "keys": [{ "text": "hi" }], "borrow": { "idleMs": 0 } });
    assert_eq!(ipc.request("agent-input", keys)["result"], json!({}));
    Instant::now()
}

/// Ask for the window's picture and do not wait for the answer.
fn ask_picture(ipc: &mut Ipc, compositor: &Compositor, window: u64) -> u64 {
    ipc.next += 1;
    let path = compositor.dir.path().join(format!("window-{}.png", ipc.next));
    let line = json!({ "id": ipc.next, "method": "capture", "params": { "window": window, "path": path } });
    writeln!(ipc.stream, "{line}").unwrap();
    ipc.next
}

/// The answer to request `id`, or None when none came in `within`.
fn answer(ipc: &mut Ipc, id: u64, within: Duration) -> Option<Value> {
    ipc.stream.set_read_timeout(Some(within)).unwrap();
    let start = Instant::now();
    let found = loop {
        let mut line = String::new();
        if ipc.reader.read_line(&mut line).is_ok() && !line.is_empty() {
            let message: Value = serde_json::from_str(&line).unwrap();
            if message["id"] == json!(id) {
                break Some(message);
            }
        }
        if start.elapsed() >= within {
            break None;
        }
    };
    ipc.stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    found
}

#[test]
fn a_picture_after_the_agents_input_waits_for_the_windows_next_frame() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, window) = movable_window(&compositor, &mut ipc, 100, 50);

    // The window draws nothing for the keys: the picture is taken when the bound is over, not before.
    let at = typed(&mut ipc, window);
    let asked = ask_picture(&mut ipc, &compositor, window);
    let late = answer(&mut ipc, asked, Duration::from_secs(5)).expect("an answer at the bound");
    assert!(
        at.elapsed() >= FRESH_WAIT - Duration::from_millis(5),
        "answered {} ms after the input: {late}",
        at.elapsed().as_millis()
    );

    // The window draws: the picture that waited is taken then.
    typed(&mut ipc, window);
    let asked = ask_picture(&mut ipc, &compositor, window);
    assert_eq!(
        answer(&mut ipc, asked, Duration::from_millis(60)),
        None,
        "taken before the window drew"
    );
    client.redraw();
    assert!(answer(&mut ipc, asked, Duration::from_secs(5)).is_some());

    // Drawn since the input, and with no input at all: no wait.
    let asked = ask_picture(&mut ipc, &compositor, window);
    assert!(answer(&mut ipc, asked, Duration::from_secs(5)).is_some());
}

/// Found proving an agent's added Desktop (11-agents): removed while the screen was still sliding
/// to it, the slide finished on a Space that was gone, and `current` was past the last one.
#[test]
fn a_space_removed_while_the_screen_slides_to_it_leaves_the_screen_where_it_was() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(
        ipc.request("space-add", json!({}))["result"]["count"],
        json!(2)
    );
    ipc.request("space-switch", json!({ "space": 1 }));
    let removed = ipc.request("space-remove", json!({ "space": 1 }))["result"].clone();
    assert_eq!(removed["count"], json!(1));
    // Longer than a slide (250 ms): the timer that would have finished it has run.
    std::thread::sleep(Duration::from_millis(400));
    let now = ipc.request("spaces", json!({}))["result"].clone();
    assert_eq!((&now["count"], &now["current"]), (&json!(1), &json!(0)));
}
