//! The vault file on disk: JSON, the header in the clear and the rest sealed.

use serde::{Deserialize, Serialize};

use super::{
    bytes::Bytes,
    crypto::{KdfParams, Sealed},
};

pub(super) const FORMAT: &str = "dashi-vault";
pub(super) const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub(super) struct File {
    pub(super) format: String,
    pub(super) version: u32,
    pub(super) kdf: KdfParams,
    /// The TPM's share, sealed by the TPM (systemd-creds), when there is one.
    #[serde(default)]
    pub(super) tpm: Option<Bytes>,
    /// The vault key, sealed by the key from the password (and the TPM's share).
    pub(super) key: Sealed,
    pub(super) body: Sealed,
}

pub(super) fn key_aad(uid: u32) -> Vec<u8> {
    format!("dashi-vault v1 key uid={uid}").into_bytes()
}

pub(super) fn body_aad(uid: u32) -> Vec<u8> {
    format!("dashi-vault v1 body uid={uid}").into_bytes()
}
