use std::sync::atomic::AtomicBool;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::fakes::{Counter, FakeEngines, FakeSound, FedMicrophone, Played, Sleepy, frame};
use crate::hub::Sink;
use crate::hub::tests::Kept;
use crate::models::store::Store;
use crate::protocol::Request;
use crate::service::{Parts, Service};

pub(super) struct World {
    pub(super) service: Arc<Service>,
    pub(super) sink: Sink,
    kept: Arc<Mutex<Kept>>,
    pub(super) counter: Arc<Mutex<Counter>>,
    pub(super) played: Arc<Played>,
    /// The microphone's frames: send to it; drop it and the sound ends.
    pub(super) microphone: Option<Sender<Vec<f32>>>,
    pub(super) microphone_closed: Arc<AtomicBool>,
    pub(super) folder: tempfile::TempDir,
}

/// A service with one microphone to give out, subscribed as connection 1; `fetcher` is the fetch program.
pub(super) fn world_with(here: bool, fetcher: &[&str]) -> World {
    let folder = tempfile::tempdir().unwrap();
    let counter = Arc::new(Mutex::new(Counter::default()));
    let (feed, frames) = channel();
    let microphone_closed = Arc::new(AtomicBool::new(false));
    let played = Arc::new(Played::default());
    let sound = FakeSound {
        microphones: Mutex::new(vec![FedMicrophone {
            frames,
            closed: microphone_closed.clone(),
        }]),
        played: played.clone(),
    };
    let engines = FakeEngines {
        here: AtomicBool::new(here),
        counter: counter.clone(),
        forgotten: Mutex::new(Vec::new()),
    };
    let service = Service::new(Parts {
        store: Store::new(folder.path()),
        engines: Box::new(engines),
        sound: Box::new(sound),
        clock: Arc::new(Sleepy::default()),
        fetcher: fetcher.iter().map(|part| (*part).to_owned()).collect(),
    });
    let kept = Arc::new(Mutex::new(Kept::default()));
    let sink: Sink = kept.clone();
    service.handle(1, &sink, Request::Subscribe).unwrap();
    World {
        service,
        sink,
        kept,
        counter,
        played,
        microphone: Some(feed),
        microphone_closed,
        folder,
    }
}

pub(super) fn world() -> World {
    world_with(true, &["false"])
}

impl World {
    pub(super) fn ask(&self, request: Request) -> Result<Value, String> {
        self.service.handle(1, &self.sink, request)
    }

    pub(super) fn feed(&self, frames: usize, loud: bool) {
        for _ in 0..frames {
            self.microphone.as_ref().unwrap().send(frame(loud)).unwrap();
        }
    }

    /// Every event so far, in order.
    pub(super) fn events(&self) -> Vec<Value> {
        let bytes = self.kept.lock().unwrap().bytes.clone();
        String::from_utf8(bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// The events of one kind.
    pub(super) fn events_named(&self, name: &str) -> Vec<Value> {
        self.events()
            .into_iter()
            .filter(|event| event["event"] == name)
            .collect()
    }

    /// The states told so far.
    pub(super) fn states(&self) -> Vec<String> {
        self.events_named("state")
            .iter()
            .map(|event| event["state"].as_str().unwrap().to_owned())
            .collect()
    }

    /// Turn the loop until `done` holds: the service's threads are real, though its clock is not.
    pub(super) fn until(&self, what: &str, done: impl Fn(&World) -> bool) {
        for _ in 0..2000 {
            if done(self) {
                return;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        panic!("never happened: {what}; events: {:?}", self.events());
    }
}
