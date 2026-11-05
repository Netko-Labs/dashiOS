//! org.freedesktop.Secret.Collection, at a collection's path and at each of
//! its aliases' (`/aliases/default`, which libsecret uses directly).

use std::{collections::HashMap, sync::Arc};

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use zbus::{
    Connection, ObjectServer, fdo, interface,
    message::Header,
    zvariant::{OwnedObjectPath, OwnedValue},
};
use zeroize::Zeroizing;

use super::{
    Shared, no_such_object, objects, peer,
    service::{WireSecret, label_of, secret_from},
};

pub struct Collection {
    pub shared: Arc<Shared>,
    pub id: String,
}

impl Collection {
    fn record(&self) -> fdo::Result<Value> {
        objects::collections(&self.shared)?
            .into_iter()
            .find(|c| c["id"] == self.id.as_str())
            .ok_or_else(no_such_object)
    }

    fn item_paths(
        &self,
        attributes: &HashMap<String, String>,
    ) -> fdo::Result<Vec<OwnedObjectPath>> {
        let found = objects::items(
            &self.shared,
            json!({ "op": "search", "attributes": attributes, "collection": self.id }),
        )?;
        Ok(found
            .iter()
            .filter_map(|i| i["id"].as_u64().map(|id| objects::item_path(&self.id, id)))
            .collect())
    }
}

fn attributes_of(properties: &HashMap<String, OwnedValue>) -> HashMap<String, String> {
    properties
        .get("org.freedesktop.Secret.Item.Attributes")
        .and_then(|v| HashMap::<String, String>::try_from(v.clone()).ok())
        .unwrap_or_default()
}

#[interface(name = "org.freedesktop.Secret.Collection")]
impl Collection {
    async fn delete(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<OwnedObjectPath> {
        peer::check(connection, &header).await?;
        if self.id == "login" {
            // The default collection holds the imported login keyring; it stays.
            return Err(fdo::Error::AccessDenied(
                "the login collection can't be deleted".into(),
            ));
        }
        self.shared
            .call(&json!({ "op": "delete-collection", "id": self.id }))?;
        objects::sync(server, &self.shared).await?;
        Ok(objects::none())
    }

    async fn search_items(
        &self,
        attributes: HashMap<String, String>,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<Vec<OwnedObjectPath>> {
        peer::check(connection, &header).await?;
        objects::sync(server, &self.shared).await?;
        self.item_paths(&attributes)
    }

    async fn create_item(
        &self,
        properties: HashMap<String, OwnedValue>,
        secret: WireSecret,
        replace: bool,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
        #[zbus(object_server)] server: &ObjectServer,
    ) -> fdo::Result<(OwnedObjectPath, OwnedObjectPath)> {
        let peer = peer::check(connection, &header).await?;
        let value = secret_from(&self.shared, &secret, &peer.sender)?;
        let encoded = Zeroizing::new(STANDARD.encode(value.expose()));
        let request = json!({
            "op": "create-item",
            "collection": self.id,
            "label": label_of(&properties, "org.freedesktop.Secret.Item.Label"),
            "attributes": attributes_of(&properties),
            "secret": encoded.as_str(),
            "contentType": if secret.3.is_empty() { "text/plain" } else { secret.3.as_str() },
            "replace": replace,
        });
        let reply = self.shared.call(&request)?;
        drop(request);
        objects::sync(server, &self.shared).await?;
        let id = reply["id"]
            .as_u64()
            .ok_or_else(|| fdo::Error::Failed("no item".into()))?;
        Ok((objects::item_path(&self.id, id), objects::none()))
    }

    #[zbus(property)]
    async fn items(&self) -> fdo::Result<Vec<OwnedObjectPath>> {
        self.item_paths(&HashMap::new())
    }

    #[zbus(property)]
    async fn label(&self) -> fdo::Result<String> {
        Ok(self.record()?["label"]
            .as_str()
            .unwrap_or_default()
            .to_string())
    }

    #[zbus(property)]
    async fn locked(&self) -> bool {
        !self.shared.unlocked()
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
