//! dashi-secretd's socket protocol: one JSON request per line,
//! `{"op": "...", ...}`, one reply per line, `{"ok": true, ...}` or
//! `{"ok": false, "error": "..."}`. docs/secrets.md lists every op and who may
//! send it. Secrets travel as base64 (`secret`) or text (`password`), and only
//! in the replies that exist to carry them.

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::vault::{
    bytes::{Bytes, Secret},
    item::AgentUse,
};

/// The longest request line: a login keyring file fits, a runaway client doesn't.
pub const MAX_LINE: usize = 4 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    // --- From PAM (root) only ------------------------------------------------
    /// The login password, at login: opens the vault, or makes it the first
    /// time (and imports the login keyring's file, when given).
    Unlock {
        user: u32,
        password: Secret,
        #[serde(default)]
        keyring: Option<Bytes>,
    },
    /// The session ended.
    Lock {
        user: u32,
    },

    // --- From the person's own processes (never an agent's) ------------------
    Status {},
    /// Open the vault with the password typed again (it was locked).
    UnlockSelf {
        password: Secret,
    },
    LockSelf {},
    /// Whether this is the password, for a payment or a passkey's check.
    Verify {
        password: Secret,
    },
    ChangePassword {
        old: Secret,
        new: Secret,
    },

    // The Secret Service, for the bridge.
    Collections {},
    CreateCollection {
        label: String,
        #[serde(default)]
        alias: Option<String>,
    },
    DeleteCollection {
        id: String,
    },
    SetAlias {
        alias: String,
        collection: Option<String>,
    },
    Search {
        #[serde(default)]
        attributes: BTreeMap<String, String>,
        #[serde(default)]
        collection: Option<String>,
    },
    GetSecret {
        id: u64,
    },
    CreateItem {
        collection: String,
        label: String,
        #[serde(default)]
        attributes: BTreeMap<String, String>,
        secret: Secret,
        #[serde(default = "text_plain", rename = "contentType")]
        content_type: String,
        #[serde(default)]
        replace: bool,
    },
    SetSecret {
        id: u64,
        secret: Secret,
        #[serde(default = "text_plain", rename = "contentType")]
        content_type: String,
    },
    SetItem {
        id: u64,
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        attributes: Option<BTreeMap<String, String>>,
    },
    DeleteItem {
        id: u64,
    },
    /// The portal's Secret: this app's own secret, made on first use.
    AppSecret {
        #[serde(rename = "appId")]
        app_id: String,
    },

    // Logins, for the shell's broker and Settings › Passwords.
    Logins {
        #[serde(default)]
        site: Option<String>,
    },
    SaveLogin {
        site: String,
        account: String,
        password: Secret,
        #[serde(default)]
        totp: Option<Secret>,
        #[serde(default)]
        agents: AgentUse,
    },
    UpdateLogin {
        id: u64,
        #[serde(default)]
        account: Option<String>,
        #[serde(default)]
        password: Option<Secret>,
        #[serde(default)]
        totp: Option<Secret>,
        #[serde(default)]
        agents: Option<AgentUse>,
    },
    DeleteLogin {
        id: u64,
    },
    /// The password, for the broker to type into the field it checked.
    /// `forAgent`: an agent asked, so a login marked "Never" is refused.
    RevealPassword {
        id: u64,
        #[serde(default, rename = "forAgent")]
        for_agent: bool,
    },
    // Payments (docs/secrets.md, "Payments").
    Cards {},
    SaveCard {
        label: String,
        number: Secret,
        expiry: String,
        cvc: Secret,
        #[serde(default, rename = "singleUse")]
        single_use: bool,
    },
    DeleteCard {
        id: u64,
    },
    Spending {},
    /// New limits, in cents; the login password proves it is the person.
    SetLimits {
        #[serde(rename = "perPayment")]
        per_payment: u64,
        #[serde(rename = "perMonth")]
        per_month: u64,
        password: Secret,
    },
    /// Pay `merchant` `cents` with card `card`: within the limits, asked of
    /// the person (finger or password), then the card for the broker to type.
    Pay {
        merchant: String,
        cents: u64,
        card: u64,
    },

    // Questions to the person (passkeys, payments), for the shell.
    /// This connection stays open and hears `{"event": "approve", id, kind, …}`.
    WatchApprovals {},
    /// Yes to question `id`, proven by the login password.
    Approve {
        id: u64,
        password: Secret,
    },
    Deny {
        id: u64,
    },
    /// The passkeys, without their keys (Settings › Passwords).
    Passkeys {},
    DeletePasskey {
        id: u64,
    },

    /// The login's current one-time code (its TOTP secret stays here).
    Code {
        id: u64,
        #[serde(default, rename = "forAgent")]
        for_agent: bool,
    },
}

fn text_plain() -> String {
    "text/plain".into()
}

impl Request {
    /// The ops only root (PAM) may send.
    pub fn is_pam(&self) -> bool {
        matches!(self, Request::Unlock { .. } | Request::Lock { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_parse_and_unknown_fields_are_refused() {
        let r: Request = serde_json::from_str(r#"{"op":"logins","site":"github.com"}"#).unwrap();
        assert!(matches!(r, Request::Logins { site: Some(_) }));
        let r: Request =
            serde_json::from_str(r#"{"op":"unlock","user":1000,"password":"aHVudGVyMg=="}"#)
                .unwrap();
        assert!(r.is_pam());
        assert!(serde_json::from_str::<Request>(r#"{"op":"status","sneaky":1}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"op":"dump-everything"}"#).is_err());
        // Never printed, even when the request is.
        let r: Request =
            serde_json::from_str(r#"{"op":"verify","password":"aHVudGVyMg=="}"#).unwrap();
        assert!(!format!("{r:?}").contains("aHVudGVyMg"));
    }
}
