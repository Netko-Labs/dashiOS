//! A passkey for the virtual security key (fido/).

use serde::{Deserialize, Serialize};

use crate::vault::bytes::{Bytes, Secret};

/// A passkey: a P-256 key for one site (its relying party id), made and used
/// only inside the vault. The private key never leaves; only signatures do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Passkey {
    pub id: u64,
    #[serde(rename = "rpId")]
    pub rp_id: String,
    #[serde(rename = "credentialId")]
    pub credential_id: Bytes,
    #[serde(rename = "userHandle")]
    pub user_handle: Bytes,
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
