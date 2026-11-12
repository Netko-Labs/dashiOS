//! org.freedesktop.Secret.Service at /org/freedesktop/secrets, and its
//! sessions. Every method checks its caller first (peer.rs). The vault is
//! unlocked at login, so no method ever needs a prompt: "/" is answered.

use std::{collections::HashMap, sync::Arc, sync::atomic::Ordering};

use serde_json::json;
use zbus::{
    Connection, ObjectServer, fdo, interface,
    message::Header,
    zvariant::{OwnedObjectPath, OwnedValue, Value},
};

use super::{
    SERVICE_PATH, Shared, no_such_object, objects, peer,
    session::{self, Algorithm, Session},
};

pub use super::{
    session_object::SessionObject,
    wire::{WireSecret, label_of, secret_for, secret_from},
};

/// The Secret Service object: sessions are opened here, collections found through it.
pub struct Service {
    pub shared: Arc<Shared>,
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
