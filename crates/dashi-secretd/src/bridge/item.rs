//! org.freedesktop.Secret.Item: one secret, its label and attributes.

use std::{collections::HashMap, sync::Arc};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use zbus::{
    Connection, ObjectServer, fdo, interface,
    message::Header,
    zvariant::{ObjectPath, OwnedObjectPath},
};
use zeroize::Zeroizing;

use super::{
    Shared, no_such_object, objects, peer,
    service::{WireSecret, secret_for, secret_from},
};

pub struct Item {
    pub shared: Arc<Shared>,
    pub id: u64,
}

impl Item {
    fn record(&self) -> fdo::Result<Value> {
        objects::items(&self.shared, json!({ "op": "search" }))?
            .into_iter()
            .find(|i| i["id"].as_u64() == Some(self.id))
            .ok_or_else(no_such_object)
    }
}

#[interface(name = "org.freedesktop.Secret.Item")]
impl Item {
    async fn delete(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<OwnedObjectPath> {
        peer::check(connection, &header).await?;
        self.shared
            .call(&json!({ "op": "delete-item", "id": self.id }))?;
        objects::sync(server, &self.shared).await?;
        Ok(objects::none())
    }

    async fn get_secret(
        &self,
        session: OwnedObjectPath,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<(WireSecret,)> {
        let peer = peer::check(connection, &header).await?;
        let session: &ObjectPath<'_> = &session;
        // One argument, the secret struct (a bare tuple would be four).
        secret_for(&self.shared, self.id, session, &peer.sender).map(|secret| (secret,))
    }

    async fn set_secret(
        &self,
        secret: WireSecret,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<()> {
        let peer = peer::check(connection, &header).await?;
        let value = secret_from(&self.shared, &secret, &peer.sender)?;
        let encoded = Zeroizing::new(STANDARD.encode(value.expose()));
        let content = if secret.3.is_empty() {
            "text/plain"
        } else {
            secret.3.as_str()
        };
        self.shared
            .call(&json!({ "op": "set-secret", "id": self.id, "secret": encoded.as_str(), "contentType": content }))?;
        Ok(())
    }

    #[zbus(property)]
    async fn locked(&self) -> bool {
        !self.shared.unlocked()
    }

    #[zbus(property)]
    async fn attributes(&self) -> fdo::Result<HashMap<String, String>> {
        let record = self.record()?;
        Ok(record["attributes"]
            .as_object()
            .map(|map| {
                map.iter()
                    .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
                    .collect()
            })
            .unwrap_or_default())
    }

    #[zbus(property)]
    async fn set_attributes(&mut self, attributes: HashMap<String, String>) -> fdo::Result<()> {
        self.shared
            .call(&json!({ "op": "set-item", "id": self.id, "attributes": attributes }))
            .map(|_| ())
    }

    #[zbus(property)]
    async fn label(&self) -> fdo::Result<String> {
        Ok(self.record()?["label"]
            .as_str()
            .unwrap_or_default()
            .to_string())
    }

    #[zbus(property)]
    async fn set_label(&mut self, label: String) -> fdo::Result<()> {
        self.shared
            .call(&json!({ "op": "set-item", "id": self.id, "label": label }))
            .map(|_| ())
    }

    #[zbus(property)]
    async fn created(&self) -> fdo::Result<u64> {
        Ok(self.record()?["created"].as_u64().unwrap_or(0))
    }

    #[zbus(property)]
    async fn modified(&self) -> fdo::Result<u64> {
        Ok(self.record()?["modified"].as_u64().unwrap_or(0))
    }
}
