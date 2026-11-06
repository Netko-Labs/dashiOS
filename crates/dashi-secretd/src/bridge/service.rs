//! org.freedesktop.Secret.Service at /org/freedesktop/secrets, and its
//! sessions. Every method checks its caller first (peer.rs). The vault is
//! unlocked at login, so no method ever needs a prompt: "/" is answered.

use std::{collections::HashMap, sync::Arc, sync::atomic::Ordering};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::json;
use zbus::{
    Connection, ObjectServer, fdo, interface,
    message::Header,
    zvariant::{ObjectPath, OwnedObjectPath, OwnedValue, Value},
};

use super::{
    SERVICE_PATH, Shared, no_such_object, objects, peer,
    session::{self, Algorithm, Session},
};
use crate::vault::bytes::Secret;

/// A secret on the wire: (session, parameters, value, content type).
pub type WireSecret = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);

pub struct Service {
    pub shared: Arc<Shared>,
}

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

#[interface(name = "org.freedesktop.Secret.Service")]
impl Service {
    async fn open_session(
        &self,
        algorithm: &str,
        input: OwnedValue,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<(OwnedValue, OwnedObjectPath)> {
        let peer = peer::check(connection, &header).await?;
        let (output, algorithm): (Value<'static>, Algorithm) = match algorithm {
            session::PLAIN => (Value::from(""), Algorithm::Plain),
            session::DH => {
                let theirs = Vec::<u8>::try_from(input)
                    .map_err(|_| fdo::Error::InvalidArgs("a public key is needed".into()))?;
                let (ours, key) = session::negotiate(&theirs).map_err(fdo::Error::InvalidArgs)?;
                (Value::from(ours), Algorithm::Aes(key))
            }
            _ => {
                return Err(fdo::Error::NotSupported(format!(
                    "{}.Error.NotSupported",
                    super::PREFIX
                )));
            }
        };
        let n = self.shared.next_session.fetch_add(1, Ordering::SeqCst) + 1;
        let path = objects::path(format!("{SERVICE_PATH}/session/s{n}"));
        self.shared
            .sessions
            .lock()
            .map_err(|_| fdo::Error::Failed("sessions".into()))?
            .insert(
                path.to_string(),
                Session {
                    owner: peer.sender,
                    algorithm,
                },
            );
        server
            .at(
                &path,
                SessionObject {
                    shared: self.shared.clone(),
                    path: path.to_string(),
                },
            )
            .await?;
        let output = OwnedValue::try_from(output).map_err(|e| fdo::Error::Failed(e.to_string()))?;
        Ok((output, path))
    }

    async fn create_collection(
        &self,
        properties: HashMap<String, OwnedValue>,
        alias: &str,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<(OwnedObjectPath, OwnedObjectPath)> {
        peer::check(connection, &header).await?;
        let label = label_of(&properties, "org.freedesktop.Secret.Collection.Label");
        let alias = (!alias.is_empty()).then_some(alias);
        let reply = self
            .shared
            .call(&json!({ "op": "create-collection", "label": label, "alias": alias }))?;
        objects::sync(server, &self.shared).await?;
        Ok((
            objects::collection_path(reply["id"].as_str().unwrap_or_default()),
            objects::none(),
        ))
    }

    async fn search_items(
        &self,
        attributes: HashMap<String, String>,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<(Vec<OwnedObjectPath>, Vec<OwnedObjectPath>)> {
        peer::check(connection, &header).await?;
        if !self.shared.unlocked() {
            return Ok((Vec::new(), Vec::new()));
        }
        objects::sync(server, &self.shared).await?;
        let found = objects::items(
            &self.shared,
            json!({ "op": "search", "attributes": attributes }),
        )?;
        let paths = found
            .iter()
            .filter_map(|i| {
                Some(objects::item_path(
                    i["collection"].as_str()?,
                    i["id"].as_u64()?,
                ))
            })
            .collect();
        Ok((paths, Vec::new()))
    }

    async fn unlock(
        &self,
        objects: Vec<OwnedObjectPath>,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<(Vec<OwnedObjectPath>, OwnedObjectPath)> {
        peer::check(connection, &header).await?;
        // Unlocked at login, or not at all: nothing here can unlock it.
        let unlocked = if self.shared.unlocked() {
            objects
        } else {
            Vec::new()
        };
        Ok((unlocked, objects::none()))
    }

    async fn lock(
        &self,
        _objects: Vec<OwnedObjectPath>,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<(Vec<OwnedObjectPath>, OwnedObjectPath)> {
        peer::check(connection, &header).await?;
        // An app can't lock the person's vault for everyone.
        Ok((Vec::new(), objects::none()))
    }

    async fn get_secrets(
        &self,
        items: Vec<OwnedObjectPath>,
        session: OwnedObjectPath,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<HashMap<OwnedObjectPath, WireSecret>> {
        let peer = peer::check(connection, &header).await?;
        let mut out = HashMap::new();
        for item in items {
            let Some(id) = objects::item_id(&item) else {
                continue;
            };
            if let Ok(secret) = secret_for(&self.shared, id, &session, &peer.sender) {
                out.insert(item, secret);
            }
        }
        Ok(out)
    }

    async fn read_alias(
        &self,
        name: &str,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<OwnedObjectPath> {
        peer::check(connection, &header).await?;
        objects::sync(server, &self.shared).await?;
        let found = objects::collections(&self.shared)?
            .into_iter()
            .find(|c| c["alias"].as_str() == Some(name))
            .and_then(|c| c["id"].as_str().map(objects::collection_path));
        Ok(found.unwrap_or_else(objects::none))
    }

    async fn set_alias(
        &self,
        name: &str,
        collection: OwnedObjectPath,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<()> {
        peer::check(connection, &header).await?;
        let id = if collection.as_str() == "/" {
            None
        } else {
            Some(objects::collection_of(&self.shared, &collection)?.ok_or_else(no_such_object)?)
        };
        self.shared
            .call(&json!({ "op": "set-alias", "alias": name, "collection": id }))?;
        objects::sync(server, &self.shared).await
    }

    #[zbus(property)]
    async fn collections(&self) -> fdo::Result<Vec<OwnedObjectPath>> {
        if !self.shared.unlocked() {
            return Ok(Vec::new());
        }
        Ok(objects::collections(&self.shared)?
            .iter()
            .filter_map(|c| c["id"].as_str().map(objects::collection_path))
            .collect())
    }
}

/// org.freedesktop.Secret.Session: closing it forgets its key.
pub struct SessionObject {
    shared: Arc<Shared>,
    path: String,
}

/// Forget the session at `path` if it is `sender`'s; another caller is refused.
fn forget(shared: &Shared, path: &str, sender: &str) -> fdo::Result<()> {
    let mut sessions = shared
        .sessions
        .lock()
        .map_err(|_| fdo::Error::Failed("sessions".into()))?;
    if sessions.get(path).is_some_and(|s| s.owner != sender) {
        return Err(fdo::Error::AccessDenied(
            "that session belongs to another app".into(),
        ));
    }
    sessions.remove(path);
    Ok(())
}

#[interface(name = "org.freedesktop.Secret.Session")]
impl SessionObject {
    async fn close(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<()> {
        let peer = peer::check(connection, &header).await?;
        forget(&self.shared, &self.path, &peer.sender)?;
        let path = ObjectPath::try_from(self.path.as_str())
            .map_err(|e| fdo::Error::Failed(e.to_string()))?;
        server.remove::<SessionObject, _>(&path).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_owner_closes_a_session() {
        let shared = Shared::new("/nonexistent".into());
        let path = "/org/freedesktop/secrets/session/s1";
        shared.sessions.lock().unwrap().insert(
            path.into(),
            Session {
                owner: ":1.10".into(),
                algorithm: Algorithm::Plain,
            },
        );
        assert!(matches!(
            forget(&shared, path, ":1.11"),
            Err(fdo::Error::AccessDenied(_))
        ));
        assert!(shared.sessions.lock().unwrap().contains_key(path));
        forget(&shared, path, ":1.10").unwrap();
        assert!(shared.sessions.lock().unwrap().is_empty());
        // Already gone: nothing left to protect, so its object may go.
        forget(&shared, path, ":1.11").unwrap();
    }
}
