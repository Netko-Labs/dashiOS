//! Secret Service collections and the items in them.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::vault::bytes::Secret;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    /// A D-Bus path element: [A-Za-z0-9_].
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub alias: Option<String>,
    pub created: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretItem {
    pub id: u64,
    pub collection: String,
    pub label: String,
    pub attributes: BTreeMap<String, String>,
    pub secret: Secret,
    pub content_type: String,
    pub created: u64,
    pub modified: u64,
}
