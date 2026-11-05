//! Token items (docs/secrets.md, "Tokens that stay home"): an API token, the
//! hosts it is for, and the header it goes in. Agents hold a placeholder
//! (`dashi:<name>`); the shell's proxy asks for the token only for a request
//! to a listed host, and swaps it in there.

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
    /// "<Header-Name>: <value with {} where the token goes>".
    pub header: String,
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
    pub header: String,
    pub created: u64,
    pub modified: u64,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<u64>,
}

impl Token {
    pub fn summary(&self) -> TokenSummary {
        TokenSummary {
            id: self.id,
            name: self.name.clone(),
            hosts: self.hosts.clone(),
            header: self.header.clone(),
            created: self.created,
            modified: self.modified,
            last_used: self.last_used,
        }
    }
}
