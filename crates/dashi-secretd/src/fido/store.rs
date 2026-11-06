//! Passkeys in the vault: made, found, and used to sign, without the private
//! key ever leaving this module. P-256 (ES256), the algorithm every browser
//! and site takes.

use p256::ecdsa::{Signature, SigningKey, signature::Signer};
use sha2::{Digest, Sha256};

use crate::vault::{
    Data,
    bytes::{Bytes, Secret},
    crypto,
    item::Passkey,
};

/// The most passkeys one vault holds.
const MAX_PASSKEYS: usize = 1000;

/// A passkey as the authenticator may see it: no private key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub credential_id: Vec<u8>,
    pub user_handle: Vec<u8>,
    pub user_name: String,
}

/// authenticatorData's flags.
pub const UP: u8 = 0x01;
pub const UV: u8 = 0x04;
pub const AT: u8 = 0x40;

pub fn rp_id_hash(rp_id: &str) -> [u8; 32] {
    Sha256::digest(rp_id.as_bytes()).into()
}

/// The passkeys for `rp_id` (only those in `allow`, when it lists any), the most recently used first.
pub fn find(data: &Data, rp_id: &str, allow: &[Vec<u8>]) -> Vec<Found> {
    let mut found: Vec<&Passkey> = data
        .passkeys
        .iter()
        .filter(|p| {
            p.rp_id == rp_id
                && (allow.is_empty() || allow.iter().any(|id| id == &p.credential_id.0))
        })
        .collect();
    found.sort_by(|a, b| {
        b.last_used
            .cmp(&a.last_used)
            .then(b.created.cmp(&a.created))
    });
    found
        .into_iter()
        .map(|p| Found {
            credential_id: p.credential_id.0.clone(),
            user_handle: p.user_handle.0.clone(),
            user_name: p.user_name.clone(),
        })
        .collect()
}

/// A new passkey's credential id and public key (x, y).
pub type Made = (Vec<u8>, [u8; 32], [u8; 32]);

/// A new passkey; its credential id and public key (x, y).
pub fn create(
    data: &mut Data,
    rp_id: &str,
    user_handle: &[u8],
    user_name: &str,
    now: u64,
) -> Result<Made, String> {
    if data.passkeys.len() >= MAX_PASSKEYS {
        return Err("the vault is full".into());
    }
    let scalar = Secret::new(crypto::random::<32>().to_vec());
    let key =
        SigningKey::from_slice(scalar.expose()).map_err(|_| "no key could be made".to_string())?;
    let point = key.verifying_key().to_encoded_point(false);
    let (Some(x), Some(y)) = (point.x(), point.y()) else {
        return Err("no key could be made".into());
    };
    let credential_id = crypto::random::<32>().to_vec();
    // A site registering the same user again replaces the old passkey.
    data.passkeys
        .retain(|p| !(p.rp_id == rp_id && p.user_handle.0 == user_handle));
    let id = data.next_id();
    data.passkeys.push(Passkey {
        id,
        rp_id: rp_id.into(),
        credential_id: Bytes(credential_id.clone()),
        user_handle: Bytes(user_handle.to_vec()),
        user_name: user_name.into(),
        private_key: scalar,
        sign_count: 0,
        created: now,
        last_used: None,
    });
    Ok((credential_id, (*x).into(), (*y).into()))
}

/// Sign in with a passkey: authenticatorData (with the next signature count) and the DER signature over it and the client's data hash.
pub fn sign(
    data: &mut Data,
    credential_id: &[u8],
    flags: u8,
    client_data_hash: &[u8],
    now: u64,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let passkey = data
        .passkeys
        .iter_mut()
        .find(|p| p.credential_id.0 == credential_id)
        .ok_or("no such passkey")?;
    passkey.sign_count = passkey.sign_count.wrapping_add(1);
    passkey.last_used = Some(now);
    let mut auth_data = rp_id_hash(&passkey.rp_id).to_vec();
    auth_data.push(flags);
    auth_data.extend_from_slice(&passkey.sign_count.to_be_bytes());
    let key = SigningKey::from_slice(passkey.private_key.expose())
        .map_err(|_| "a damaged passkey".to_string())?;
    let mut message = auth_data.clone();
    message.extend_from_slice(client_data_hash);
    let signature: Signature = key.sign(&message);
    Ok((auth_data, signature.to_der().as_bytes().to_vec()))
}
