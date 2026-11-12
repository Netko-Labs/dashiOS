//! The service: what a request does. One `Service` holds the models, the
//! sound, who is subscribed, and what Voice is doing now; each connection
//! calls `handle` with its requests.

mod capture;
pub(crate) mod clock;
pub(crate) mod engines;
mod fetching;
mod listen;
mod player;
mod speak;
mod voices;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

pub(crate) use self::fetching::UNIT as FETCH_UNIT;
pub(crate) use self::voices::choose as choose_voice;

use self::clock::Clock;
use self::engines::Engines;
use crate::audio::pipewire::Sound;
use crate::hub::{Hub, Sink};
use crate::models::manifest::{self, SETS};
use crate::models::store::Store;
use crate::protocol::{Event, Request, State, Warm};

/// Models unused this long are let go of; `DASHI_VOICE_IDLE_S` changes it.
const IDLE: Duration = Duration::from_secs(600);

/// What is going on, from which the one state is read.
#[derive(Default)]
struct Activity {
    listening: bool,
    speaking: bool,
    thinking: usize,
    told: Option<State>,
}

impl Activity {
    fn state(&self) -> State {
        if self.listening {
            State::Listening
        } else if self.speaking {
            State::Speaking
        } else if self.thinking > 0 {
            State::Thinking
        } else {
            State::Idle
        }
    }
}

pub(crate) struct Service {
    pub(crate) hub: Hub,
    store: Store,
    engines: Box<dyn Engines>,
    sound: Box<dyn Sound>,
    clock: Arc<dyn Clock>,
    activity: Mutex<Activity>,
    listening: listen::Listening,
    speech: speak::Speech,
    fetching: fetching::Fetching,
}

/// What a service is made of: the real pieces, or a test's.
pub(crate) struct Parts {
    pub(crate) store: Store,
    pub(crate) engines: Box<dyn Engines>,
    pub(crate) sound: Box<dyn Sound>,
    pub(crate) clock: Arc<dyn Clock>,
    /// The program that fetches models, and its first arguments.
    pub(crate) fetcher: Vec<String>,
}

impl Service {
    pub(crate) fn new(parts: Parts) -> Arc<Self> {
        let service = Arc::new(Self {
            hub: Hub::default(),
            store: parts.store,
            engines: parts.engines,
            sound: parts.sound,
            clock: parts.clock,
            activity: Mutex::new(Activity::default()),
            listening: listen::Listening::default(),
            speech: speak::Speech::default(),
            fetching: fetching::Fetching::new(parts.fetcher),
        });
        speak::start(&service);
        service
    }

    /// Change what is going on, and tell the subscribers if the state changed.
    fn act(&self, change: impl FnOnce(&mut Activity)) {
        let Ok(mut activity) = self.activity.lock() else {
            return;
        };
        change(&mut activity);
        let state = activity.state();
        if activity.told != Some(state) {
            activity.told = Some(state);
            // Told under the lock, so two changes are never told out of order.
            self.hub.emit(&Event::State { state });
        }
    }

    fn state(&self) -> State {
        self.activity
            .lock()
            .map_or(State::Idle, |activity| activity.state())
    }

    pub(crate) fn handle(
        self: &Arc<Self>,
        connection: u64,
        sink: &Sink,
        request: Request,
    ) -> Result<Value, String> {
        self.engines.touch(self.clock.now());
        match request {
            Request::Status => Ok(self.status()),
            Request::Subscribe => {
                self.hub.subscribe(connection, sink.clone());
                Ok(json!({ "state": self.state() }))
            }
            Request::Models => Ok(self.models()),
            Request::Fetch(sets) => self.fetch(sets.sets),
            Request::FetchCancel => {
                self.fetching.cancel();
                Ok(json!({}))
            }
            Request::Remove(sets) => self.remove(sets.sets),
            Request::Voices => Ok(voices::list(&self.store)),
            Request::Warm(warm) => self.warm(&warm),
            Request::Listen(params) => self.listen(connection, params),
            Request::ListenStop => self.listen_stop(),
            Request::ListenQuiet(quiet) => self.listen_quiet(&quiet),
            Request::ListenCancel => {
                self.listen_cancel(None);
                Ok(json!({}))
            }
            Request::Speak(params) => self.speak(params),
            Request::SpeakStop => {
                self.speak_stop();
                Ok(json!({}))
            }
        }
    }

    /// A connection closed: nothing it started goes on listening.
    pub(crate) fn hang_up(&self, connection: u64) {
        self.hub.unsubscribe(connection);
        self.listen_cancel(Some(connection));
    }

    /// Let go of models nobody used for a while; called now and then.
    pub(crate) fn rest(&self) {
        let idle = std::env::var("DASHI_VOICE_IDLE_S")
            .ok()
            .and_then(|seconds| seconds.parse().ok())
            .map_or(IDLE, Duration::from_secs);
        if self.state() == State::Idle {
            self.engines.rest(self.clock.now(), idle);
        }
    }

    fn status(&self) -> Value {
        let here = |id: &str| self.store.installed_id(id);
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "state": self.state(),
            "listen": here(manifest::LISTEN_SET),
            "speak": here(manifest::SPEAK_SET),
            "whisper": here(manifest::WHISPER_SET),
            "fetching": self.fetching.running(),
        })
    }

    fn models(&self) -> Value {
        let sets: Vec<Value> = SETS
            .iter()
            .map(|set| {
                json!({
                    "id": set.id,
                    "name": set.name,
                    "about": set.about,
                    "credit": set.credit,
                    "basic": set.basic,
                    "bytes": set.bytes(),
                    "have": self.store.have(set),
                    "installed": self.store.installed(set),
                })
            })
            .collect();
        json!({ "folder": self.store.folder(), "fetching": self.fetching.running(), "sets": sets })
    }

    fn warm(&self, warm: &Warm) -> Result<Value, String> {
        if warm.listen {
            self.engines.recognizer(warm.language.as_deref())?;
        }
        if warm.speak {
            self.engines.synthesizer()?;
        }
        Ok(json!({}))
    }

    /// The sets asked for by id; `all` when none were named.
    fn sets(asked: Option<Vec<String>>, all: bool) -> Result<Vec<&'static manifest::Set>, String> {
        match asked {
            None => Ok(SETS.iter().filter(|set| all || set.basic).collect()),
            Some(ids) => ids
                .iter()
                .map(|id| {
                    manifest::set(id).ok_or_else(|| format!("There are no models named {id}."))
                })
                .collect(),
        }
    }

    fn remove(&self, asked: Option<Vec<String>>) -> Result<Value, String> {
        if self.fetching.running() {
            return Err("Models are being fetched. Cancel that first.".into());
        }
        for set in Self::sets(asked, true)? {
            self.engines.forget(set.id);
            self.store.remove(set)?;
        }
        self.hub.emit(&Event::Models {});
        Ok(json!({}))
    }
}

#[cfg(test)]
mod tests;
