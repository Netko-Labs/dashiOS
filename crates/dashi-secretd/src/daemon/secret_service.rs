//! The Secret Service's storage side: collections, items, aliases, and the
//! portal's per-app secrets, for dashi-secret-bridge, which speaks D-Bus to
//! apps. Each op answers its reply and whether the vault changed (to save).

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{protocol::Request, reply::Reply};
use crate::vault::{
    Vault,
    bytes::Secret,
    crypto,
    item::{Collection, SecretItem},
};

/// The most items one vault holds, so a runaway app can't fill the disk.
const MAX_ITEMS: usize = 20_000;
const MAX_SECRET: usize = 1024 * 1024;

pub fn owns(request: &Request) -> bool {
    matches!(
        request,
        Request::Collections {}
            | Request::CreateCollection { .. }
            | Request::DeleteCollection { .. }
            | Request::SetAlias { .. }
            | Request::Search { .. }
            | Request::GetSecret { .. }
            | Request::CreateItem { .. }
            | Request::SetSecret { .. }
            | Request::SetItem { .. }
            | Request::DeleteItem { .. }
            | Request::AppSecret { .. }
    )
}

fn describe(item: &SecretItem) -> Value {
    json!({
        "id": item.id,
        "collection": item.collection,
        "label": item.label,
        "attributes": item.attributes,
        "contentType": item.content_type,
        "created": item.created,
        "modified": item.modified,
    })
}

fn collection_id(label: &str, taken: &[Collection]) -> String {
    let base: String = label
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .take(32)
        .collect();
    let base = if base.is_empty() {
        "collection".to_string()
    } else {
        base
    };
    let mut id = base.clone();
    let mut n = 1;
    while taken.iter().any(|c| c.id == id) {
        n += 1;
        id = format!("{base}{n}");
    }
    id
}

fn checked_secret(secret: &Secret) -> Result<(), String> {
    if secret.expose().len() > MAX_SECRET {
        return Err("that secret is too big".into());
    }
    Ok(())
}

pub fn handle(vault: &mut Vault, request: Request, now: u64) -> Result<(Reply, bool), String> {
    let data = &mut vault.data;
    match request {
        Request::Collections {} => {
            let list: Vec<Value> = data
                .collections
                .iter()
                .map(|c| json!({ "id": c.id, "label": c.label, "alias": c.alias, "created": c.created, "modified": c.modified }))
                .collect();
            Ok((Reply::Plain(json!({ "collections": list })), false))
        }
        Request::CreateCollection { label, alias } => {
            if let Some(existing) = alias.as_deref().and_then(|a| {
                data.collections
                    .iter()
                    .find(|c| c.alias.as_deref() == Some(a))
            }) {
                return Ok((Reply::Plain(json!({ "id": existing.id })), false));
            }
            let id = collection_id(&label, &data.collections);
            data.collections.push(Collection {
                id: id.clone(),
                label,
                alias,
                created: now,
                modified: now,
            });
            Ok((Reply::Plain(json!({ "id": id })), true))
        }
        Request::DeleteCollection { id } => {
            data.collections.retain(|c| c.id != id);
            data.items.retain(|i| i.collection != id);
            Ok((Reply::ok(), true))
        }
        Request::SetAlias { alias, collection } => {
            for c in &mut data.collections {
                if c.alias.as_deref() == Some(alias.as_str()) {
                    c.alias = None;
                }
            }
            if let Some(id) = collection {
                let c = data
                    .collections
                    .iter_mut()
                    .find(|c| c.id == id)
                    .ok_or("no such collection")?;
                c.alias = Some(alias);
            }
            Ok((Reply::ok(), true))
        }
        Request::Search {
            attributes,
            collection,
        } => {
            let found: Vec<Value> = data
                .items
                .iter()
                .filter(|i| collection.as_ref().is_none_or(|c| &i.collection == c))
                .filter(|i| {
                    attributes
                        .iter()
                        .all(|(k, v)| i.attributes.get(k) == Some(v))
                })
                .map(describe)
                .collect();
            Ok((Reply::Plain(json!({ "items": found })), false))
        }
        Request::GetSecret { id } => {
            let item = data
                .items
                .iter()
                .find(|i| i.id == id)
                .ok_or("no such item")?;
            Ok((
                Reply::Secret {
                    fields: json!({ "contentType": item.content_type }),
                    key: "secret",
                    secret: item.secret.clone(),
                },
                false,
            ))
        }
        Request::CreateItem {
            collection,
            label,
            attributes,
            secret,
            content_type,
            replace,
        } => {
            checked_secret(&secret)?;
            if !data.collections.iter().any(|c| c.id == collection) {
                return Err("no such collection".into());
            }
            if replace
                && let Some(item) = data
                    .items
                    .iter_mut()
                    .find(|i| i.collection == collection && i.attributes == attributes)
            {
                item.label = label;
                item.secret = secret;
                item.content_type = content_type;
                item.modified = now;
                let id = item.id;
                return Ok((Reply::Plain(json!({ "id": id })), true));
            }
            if data.items.len() >= MAX_ITEMS {
                return Err("the vault is full".into());
            }
            let id = data.next_id();
            data.items.push(SecretItem {
                id,
                collection,
                label,
                attributes,
                secret,
                content_type,
                created: now,
                modified: now,
            });
            Ok((Reply::Plain(json!({ "id": id })), true))
        }
        Request::SetSecret {
            id,
            secret,
            content_type,
        } => {
            checked_secret(&secret)?;
            let item = data
                .items
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("no such item")?;
            item.secret = secret;
            item.content_type = content_type;
            item.modified = now;
            Ok((Reply::ok(), true))
        }
        Request::SetItem {
            id,
            label,
            attributes,
        } => {
            let item = data
                .items
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("no such item")?;
            if let Some(label) = label {
                item.label = label;
            }
            if let Some(attributes) = attributes {
                item.attributes = attributes;
            }
            item.modified = now;
            Ok((Reply::ok(), true))
        }
        Request::DeleteItem { id } => {
            let before = data.items.len();
            data.items.retain(|i| i.id != id);
            Ok((Reply::ok(), data.items.len() != before))
        }
        Request::AppSecret { app_id } => {
            if app_id.is_empty() || app_id.len() > 255 {
                return Err("an app id is needed".into());
            }
            let mut changed = false;
            let secret = data
                .app_secrets
                .entry(app_id)
                .or_insert_with(|| {
                    changed = true;
                    Secret::new(crypto::random::<64>().to_vec())
                })
                .clone();
            Ok((
                Reply::Secret {
                    fields: json!({}),
                    key: "secret",
                    secret,
                },
                changed,
            ))
        }
        _ => Err("not a Secret Service request".into()),
    }
}

/// Attributes as the bridge sends them; kept here for tests' convenience.
pub fn attributes(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}
