//! The bus objects for what the vault holds: one per collection (and one per
//! alias, the same collection under `/aliases/<name>`), one per item. They
//! are brought in line with the vault after every change and every search.

use std::{collections::HashSet, sync::Arc};

use serde_json::{Value, json};
use zbus::{
    ObjectServer, fdo,
    zvariant::{ObjectPath, OwnedObjectPath},
};

use super::{SERVICE_PATH, Shared, collection::Collection, item::Item};

pub fn path(text: String) -> OwnedObjectPath {
    OwnedObjectPath::try_from(text)
        .unwrap_or_else(|_| OwnedObjectPath::from(ObjectPath::from_static_str_unchecked("/")))
}

pub fn none() -> OwnedObjectPath {
    path("/".into())
}

/// A collection id or alias as a path element: [A-Za-z0-9_] only.
pub fn element(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

pub fn collection_path(id: &str) -> OwnedObjectPath {
    path(format!("{SERVICE_PATH}/collection/{}", element(id)))
}

pub fn alias_path(alias: &str) -> OwnedObjectPath {
    path(format!("{SERVICE_PATH}/aliases/{}", element(alias)))
}

pub fn item_path(collection: &str, id: u64) -> OwnedObjectPath {
    path(format!(
        "{SERVICE_PATH}/collection/{}/i{id}",
        element(collection)
    ))
}

/// The item id in an item's path.
pub fn item_id(path: &ObjectPath<'_>) -> Option<u64> {
    let rest = path
        .as_str()
        .strip_prefix(&format!("{SERVICE_PATH}/collection/"))?;
    let (_, last) = rest.rsplit_once('/')?;
    last.strip_prefix('i')?.parse().ok()
}

/// The collection a path names, directly or through an alias.
pub fn collection_of(shared: &Shared, path: &ObjectPath<'_>) -> fdo::Result<Option<String>> {
    if let Some(id) = path
        .as_str()
        .strip_prefix(&format!("{SERVICE_PATH}/collection/"))
    {
        return Ok((!id.contains('/')).then(|| id.to_string()));
    }
    if let Some(alias) = path
        .as_str()
        .strip_prefix(&format!("{SERVICE_PATH}/aliases/"))
    {
        return Ok(collections(shared)?
            .into_iter()
            .find(|c| c["alias"].as_str().map(element).as_deref() == Some(alias))
            .and_then(|c| c["id"].as_str().map(str::to_owned)));
    }
    Ok(None)
}

pub fn collections(shared: &Shared) -> fdo::Result<Vec<Value>> {
    Ok(shared.call(&json!({ "op": "collections" }))?["collections"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

pub fn items(shared: &Shared, query: Value) -> fdo::Result<Vec<Value>> {
    Ok(shared.call(&query)?["items"]
        .as_array()
        .cloned()
        .unwrap_or_default())
}

/// Register what is new, drop what is gone.
pub async fn sync(server: &ObjectServer, shared: &Arc<Shared>) -> fdo::Result<()> {
    let registered = &shared.registered;
    if !shared.unlocked() {
        return Ok(());
    }
    let mut wanted: Vec<(OwnedObjectPath, Wanted)> = Vec::new();
    for c in collections(shared)? {
        let Some(id) = c["id"].as_str() else { continue };
        wanted.push((collection_path(id), Wanted::Collection(id.to_string())));
        if let Some(alias) = c["alias"].as_str() {
            wanted.push((alias_path(alias), Wanted::Collection(id.to_string())));
        }
    }
    for i in items(shared, json!({ "op": "search" }))? {
        let (Some(id), Some(collection)) = (i["id"].as_u64(), i["collection"].as_str()) else {
            continue;
        };
        wanted.push((item_path(collection, id), Wanted::Item(id)));
    }
    let now: HashSet<String> = wanted.iter().map(|(p, _)| p.to_string()).collect();
    let before = registered.take();
    for (path, what) in wanted {
        let fresh = !before.contains(path.as_str());
        // An alias may have moved to another collection: re-register aliases every time.
        let is_alias = path.as_str().contains("/aliases/");
        if !fresh && !is_alias {
            continue;
        }
        match what {
            Wanted::Collection(id) => {
                if is_alias {
                    let _ = server.remove::<Collection, _>(&path).await;
                }
                server
                    .at(
                        &path,
                        Collection {
                            shared: shared.clone(),
                            id,
                        },
                    )
                    .await?;
            }
            Wanted::Item(id) => {
                server
                    .at(
                        &path,
                        Item {
                            shared: shared.clone(),
                            id,
                        },
                    )
                    .await?;
            }
        }
    }
    for gone in before.difference(&now) {
        let Ok(path) = ObjectPath::try_from(gone.as_str()) else {
            continue;
        };
        if gone.contains("/i") && item_id(&path).is_some() {
            let _ = server.remove::<Item, _>(&path).await;
        } else {
            let _ = server.remove::<Collection, _>(&path).await;
        }
    }
    registered.put(now);
    Ok(())
}

pub use registered::Registered;

enum Wanted {
    Collection(String),
    Item(u64),
}

/// What is registered now (a plain mutex, held only to swap the set).
mod registered {
    use std::{collections::HashSet, sync::Mutex};

    #[derive(Default)]
    pub struct Registered(Mutex<HashSet<String>>);

    impl Registered {
        pub fn take(&self) -> HashSet<String> {
            self.0
                .lock()
                .map(|mut set| std::mem::take(&mut *set))
                .unwrap_or_default()
        }
        pub fn put(&self, set: HashSet<String>) {
            if let Ok(mut held) = self.0.lock() {
                *held = set;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_name_collections_and_items() {
        assert_eq!(
            collection_path("login").as_str(),
            "/org/freedesktop/secrets/collection/login"
        );
        assert_eq!(
            alias_path("default").as_str(),
            "/org/freedesktop/secrets/aliases/default"
        );
        let item = item_path("login", 42);
        assert_eq!(
            item.as_str(),
            "/org/freedesktop/secrets/collection/login/i42"
        );
        assert_eq!(item_id(&item), Some(42));
        assert_eq!(item_id(&collection_path("login")), None);
        assert_eq!(element("my keys!"), "my_keys_");
    }
}
