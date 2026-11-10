//! The state the bridge's objects share, and its line to dashi-secretd.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, atomic::AtomicU64},
};

use serde_json::Value;
use zbus::fdo;

use super::{objects, session};
use crate::client::Client;

pub const SERVICE_PATH: &str = "/org/freedesktop/secrets";
pub const PREFIX: &str = "org.freedesktop.Secret";

pub struct Shared {
    socket: PathBuf,
    client: Mutex<Option<Client>>,
    pub sessions: Mutex<HashMap<String, session::Session>>,
    pub next_session: AtomicU64,
    pub registered: objects::Registered,
}

impl Shared {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            socket,
            client: Mutex::new(None),
            sessions: Mutex::new(HashMap::new()),
            next_session: AtomicU64::new(0),
            registered: objects::Registered::default(),
        }
    }

    /// One request to dashi-secretd, reconnecting once if it restarted.
    pub fn call(&self, request: &Value) -> fdo::Result<Value> {
        let mut client = self
            .client
            .lock()
            .map_err(|_| fdo::Error::Failed("the bridge is not well".into()))?;
        for attempt in 0..2 {
            if client.is_none() {
                *client = Some(Client::connect(&self.socket).map_err(fdo::Error::Failed)?);
            }
            let Some(connected) = client.as_mut() else {
                continue;
            };
            match connected.call(request) {
                Ok(value) => return Ok(value),
                Err(error) if error.starts_with("dashi-secretd:") && attempt == 0 => *client = None,
                Err(error) if error.contains("locked") => {
                    return Err(fdo::Error::Failed(format!(
                        "{PREFIX}.Error.IsLocked: {error}"
                    )));
                }
                Err(error) => return Err(fdo::Error::Failed(error)),
            }
        }
        Err(fdo::Error::Failed("dashi-secretd is not answering".into()))
    }

    pub fn unlocked(&self) -> bool {
        self.call(&serde_json::json!({ "op": "status" }))
            .is_ok_and(|status| status["unlocked"] == true)
    }
}

/// The D-Bus error a missing object gets.
pub fn no_such_object() -> fdo::Error {
    fdo::Error::UnknownObject(format!("{PREFIX}.Error.NoSuchObject"))
}
