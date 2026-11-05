//! What the vault holds, inside its sealed body: Secret Service collections
//! and items (apps' secrets), logins (a site, an account, a password, maybe a
//! TOTP secret), and the portal's per-app secrets. Secrets are `Secret`, so
//! none of this prints one.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::bytes::Secret;

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

/// A passkey: a P-256 key for one site (its relying party id), made and used
/// only inside the vault. The private key never leaves; only signatures do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Passkey {
    pub id: u64,
    #[serde(rename = "rpId")]
    pub rp_id: String,
    #[serde(rename = "credentialId")]
    pub credential_id: super::bytes::Bytes,
    #[serde(rename = "userHandle")]
    pub user_handle: super::bytes::Bytes,
    #[serde(rename = "userName")]
    pub user_name: String,
    #[serde(rename = "privateKey")]
    pub private_key: Secret,
    #[serde(rename = "signCount")]
    pub sign_count: u32,
    pub created: u64,
    #[serde(default, rename = "lastUsed")]
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

/// A site as typed ("https://GitHub.com/login") to the host it names
/// ("github.com"); None for anything that is not a plain host name.
pub fn normalize_site(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let rest = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = host.split(':').next()?.trim_end_matches('.');
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let valid = !host.is_empty()
        && host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    valid.then_some(host)
}

/// Whether a login for `site` belongs on a page at `host`: the same host, or one under it.
pub fn site_matches(site: &str, host: &str) -> bool {
    let Some(host) = normalize_site(host) else {
        return false;
    };
    host == site || host.ends_with(&format!(".{site}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sites_are_plain_host_names() {
        assert_eq!(
            normalize_site("https://GitHub.com/login?x=1").as_deref(),
            Some("github.com")
        );
        assert_eq!(normalize_site("www.ynab.com").as_deref(), Some("ynab.com"));
        assert_eq!(
            normalize_site("user@bank.example:8443/").as_deref(),
            Some("bank.example")
        );
        assert_eq!(normalize_site("localhost"), None);
        assert_eq!(normalize_site("evil .com"), None);
        assert_eq!(normalize_site(""), None);
    }

    #[test]
    fn a_login_matches_its_host_and_subdomains_only() {
        assert!(site_matches("github.com", "github.com"));
        assert!(site_matches("github.com", "https://gist.github.com/x"));
        assert!(!site_matches("github.com", "github.com.evil.example"));
        assert!(!site_matches("github.com", "evilgithub.com"));
        assert!(!site_matches("github.com", "not a host"));
    }

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
