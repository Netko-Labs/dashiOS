//! The key that wraps the vault key: from the password, and the TPM's share where there is one.

use zeroize::Zeroizing;

use super::{
    Sealer,
    bytes::Bytes,
    crypto::{self, KdfParams, Key, Sealed},
    file::key_aad,
};

/// The key-wrapping key for `password`, with the TPM's share when the vault has one.
pub(super) fn wrapping_key(
    password: &[u8],
    kdf: &KdfParams,
    tpm: Option<&Bytes>,
    sealer: &dyn Sealer,
) -> Result<Key, String> {
    let share = tpm.map(|blob| sealer.unseal(&blob.0)).transpose()?;
    crypto::derive(password, kdf, share.as_ref().map(|s| s.as_slice()))
}

pub(super) fn new_wrapping(
    uid: u32,
    password: &[u8],
    key: &Key,
    kdf: KdfParams,
    sealer: &dyn Sealer,
) -> Result<(KdfParams, Option<Bytes>, Sealed), String> {
    let share = Zeroizing::new(crypto::random::<32>());
    let tpm = sealer.seal(share.as_ref())?.map(Bytes);
    let wrapping = crypto::derive(password, &kdf, tpm.as_ref().map(|_| share.as_slice()))?;
    let wrapped = crypto::seal(&wrapping, key.as_bytes(), &key_aad(uid))?;
    Ok((kdf, tpm, wrapped))
}
