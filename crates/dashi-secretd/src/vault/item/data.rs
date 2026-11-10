//! The vault's whole contents, and the ids handed out inside it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Card, Collection, Login, Passkey, SecretItem, Spending};
use crate::vault::{bytes::Secret, token::Token};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Data {
    #[serde(default)]
    pub collections: Vec<Collection>,
    #[serde(default)]
    pub items: Vec<SecretItem>,
    #[serde(default)]
    pub logins: Vec<Login>,
    /// The portal's Secret: one secret per app id, made on first use.
    #[serde(default)]
    pub app_secrets: BTreeMap<String, Secret>,
    /// Passkeys, for the virtual security key (fido/).
    #[serde(default)]
    pub passkeys: Vec<Passkey>,
    /// Cards for payments (single-use virtual cards recommended).
    #[serde(default)]
    pub cards: Vec<Card>,
    /// What agents may spend, and what they spent.
    #[serde(default)]
    pub spending: Spending,
    /// API tokens, swapped in by the shell's proxy for their hosts only.
    #[serde(default)]
    pub tokens: Vec<Token>,
    /// What was imported already ("gnome-keyring:login"), so it happens once.
    #[serde(default)]
    pub imported: Vec<String>,
    #[serde(default)]
    pub next_id: u64,
}

impl Data {
    pub fn next_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    /// The default collection ("login", alias "default") exists from the start.
    pub fn ensure_default(&mut self, now: u64) {
        if self.collections.iter().any(|c| c.id == "login") {
            return;
        }
        self.collections.push(Collection {
            id: "login".into(),
            label: "Login".into(),
            alias: Some("default".into()),
            created: now,
            modified: now,
        });
    }
}
