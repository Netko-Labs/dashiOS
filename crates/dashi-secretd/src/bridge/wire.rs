//! Secrets on the bus: encrypted for, and decrypted with, the caller's own session.

use std::collections::HashMap;

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use zbus::{
    fdo,
    zvariant::{ObjectPath, OwnedObjectPath, OwnedValue},
};

use super::Shared;
use crate::vault::bytes::Secret;

/// A secret on the wire: (session, parameters, value, content type).
pub type WireSecret = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);

/// An item's secret, encrypted for `session`, which must be the caller's.
pub fn secret_for(
    shared: &Shared,
    id: u64,
    session: &ObjectPath<'_>,
    sender: &str,
) -> fdo::Result<WireSecret> {
    let reply = shared.call(&json!({ "op": "get-secret", "id": id }))?;
    let secret = STANDARD
        .decode(reply["secret"].as_str().unwrap_or_default())
        .map(Secret::new)
        .map_err(|_| fdo::Error::Failed("a damaged secret".into()))?;
    let sessions = shared
        .sessions
        .lock()
        .map_err(|_| fdo::Error::Failed("sessions".into()))?;
    let open = sessions
        .get(session.as_str())
        .filter(|s| s.owner == sender)
        .ok_or_else(|| fdo::Error::Failed(format!("{}.Error.NoSession", super::PREFIX)))?;
    let (parameters, value) = open.algorithm.encrypt(&secret);
    let content = reply["contentType"]
        .as_str()
        .unwrap_or("text/plain")
        .to_string();
    Ok((
        OwnedObjectPath::from(session.to_owned()),
        parameters,
        value,
        content,
    ))
}

/// A secret from the wire, decrypted with its session, which must be the caller's.
pub fn secret_from(shared: &Shared, wire: &WireSecret, sender: &str) -> fdo::Result<Secret> {
    let sessions = shared
        .sessions
        .lock()
        .map_err(|_| fdo::Error::Failed("sessions".into()))?;
    let open = sessions
        .get(wire.0.as_str())
        .filter(|s| s.owner == sender)
        .ok_or_else(|| fdo::Error::Failed(format!("{}.Error.NoSession", super::PREFIX)))?;
    open.algorithm
        .decrypt(&wire.1, &wire.2)
        .map_err(fdo::Error::InvalidArgs)
}

pub fn label_of(properties: &HashMap<String, OwnedValue>, key: &str) -> String {
    properties
        .get(key)
        .and_then(|v| String::try_from(v.clone()).ok())
        .unwrap_or_default()
}
