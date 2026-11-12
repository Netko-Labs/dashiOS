//! Logins: a site, an account, a password, maybe a TOTP secret; and how they are summarized.

use serde::{Deserialize, Serialize};

use crate::vault::bytes::Secret;

/// Whether agents may ask to use a login at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentUse {
    #[default]
    Ask,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TotpAlgorithm {
    #[default]
    Sha1,
    Sha256,
    Sha512,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Totp {
    pub secret: Secret,
    #[serde(default = "six")]
    pub digits: u32,
    #[serde(default = "thirty")]
    pub period: u64,
    #[serde(default)]
    pub algorithm: TotpAlgorithm,
}

fn six() -> u32 {
    6
}

fn thirty() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Login {
    pub id: u64,
    /// A host name, lowercase ("github.com"); it also matches its subdomains.
    pub site: String,
    pub account: String,
    pub password: Secret,
    #[serde(default)]
    pub totp: Option<Totp>,
    #[serde(default)]
    pub agents: AgentUse,
    pub created: u64,
    pub modified: u64,
    #[serde(default)]
    pub last_used: Option<u64>,
}

/// A login as anyone may see it: no password, no TOTP secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LoginSummary {
    pub id: u64,
    pub site: String,
    pub account: String,
    pub agents: AgentUse,
    #[serde(rename = "hasCode")]
    pub has_code: bool,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<u64>,
}

impl Login {
    pub fn summary(&self) -> LoginSummary {
        LoginSummary {
            id: self.id,
            site: self.site.clone(),
            account: self.account.clone(),
            agents: self.agents,
            has_code: self.totp.is_some(),
            last_used: self.last_used,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summaries_carry_no_secret() {
        let login = Login {
            id: 1,
            site: "github.com".into(),
            account: "alexk".into(),
            password: Secret::new(b"hunter2".to_vec()),
            totp: None,
            agents: AgentUse::Ask,
            created: 0,
            modified: 0,
            last_used: None,
        };
        let json = serde_json::to_string(&login.summary()).unwrap();
        assert!(!json.contains("hunter2") && !json.contains("aHVudGVyMg"));
        assert!(json.contains("alexk"));
    }
}
