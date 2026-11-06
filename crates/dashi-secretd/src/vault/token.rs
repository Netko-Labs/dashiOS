//! Token items (docs/secrets.md, "Tokens that stay home"): an API token, the
//! hosts it is for, and the headers it may go in. Agents hold a placeholder
//! (`dashi:<name>`); the shell's proxy asks for the token only for a request
//! to a listed host, and swaps it in there, in whichever of the item's
//! headers the request sent with the placeholder.

use serde::{Deserialize, Serialize};

use super::bytes::Secret;

/// Where a token goes when the item doesn't say.
pub const DEFAULT_HEADER: &str = "Authorization: Bearer {}";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Token {
    pub id: u64,
    /// The placeholder's name: `dashi:<name>`. Lowercase letters, digits, `-`, `_`, `.`.
    pub name: String,
    /// Host names ("api.github.com"); "*.example.com" for every host under example.com.
    pub hosts: Vec<String>,
    /// "<Header-Name>: <value with {} where the token goes>": the first of
    /// `headers`, kept on its own so a vault written here still reads where
    /// an item had one header only.
    pub header: String,
    /// Every header the token may go in, `header` first; empty in an item
    /// saved before there could be more than one (then it is `header` alone).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<String>,
    pub token: Secret,
    pub created: u64,
    pub modified: u64,
    #[serde(default, rename = "lastUsed")]
    pub last_used: Option<u64>,
}

/// A token item as anyone may see it: everything but the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TokenSummary {
    pub id: u64,
    pub name: String,
    pub hosts: Vec<String>,
    /// The first header, as before there could be more.
    pub header: String,
    pub headers: Vec<String>,
    pub created: u64,
    pub modified: u64,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<u64>,
}

impl Token {
    /// Every header the token may go in, in order.
    pub fn all_headers(&self) -> Vec<String> {
        if self.headers.is_empty() {
            vec![self.header.clone()]
        } else {
            self.headers.clone()
        }
    }

    /// Set the headers (checked already, at least one): `header` is the
    /// first, and an item with one header is written as it always was.
    pub fn set_headers(&mut self, headers: Vec<String>) {
        self.header = headers
            .first()
            .cloned()
            .unwrap_or_else(|| DEFAULT_HEADER.to_string());
        self.headers = if headers.len() > 1 {
            headers
        } else {
            Vec::new()
        };
    }

    pub fn summary(&self) -> TokenSummary {
        TokenSummary {
            id: self.id,
            name: self.name.clone(),
            hosts: self.hosts.clone(),
            header: self.header.clone(),
            headers: self.all_headers(),
            created: self.created,
            modified: self.modified,
            last_used: self.last_used,
        }
    }
}
