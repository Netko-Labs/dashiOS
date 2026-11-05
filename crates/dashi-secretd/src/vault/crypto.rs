//! The vault's cryptography, all of it from RustCrypto: Argon2id stretches the
//! login password, HKDF-SHA256 mixes in the TPM's share (when there is one),
//! and XChaCha20-Poly1305 seals the vault key and the vault's body. Nonces are
//! random (192 bits, so random is safe), keys are zeroed when dropped.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, OsRng, Payload, rand_core::RngCore},
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use super::bytes::Bytes;

pub const KEY_LEN: usize = 32;

/// A 256-bit key, zeroed when dropped, never printed.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Key(pub(crate) [u8; KEY_LEN]);

impl std::fmt::Debug for Key {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key([redacted])")
    }
}

impl Key {
    pub fn random() -> Self {
        Self(random())
    }

    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    OsRng.fill_bytes(&mut out);
    out
}

/// How the password is stretched; stored in the vault's header so it can grow.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    /// Memory in KiB.
    pub m: u32,
    pub t: u32,
    pub p: u32,
    pub salt: Bytes,
}

impl KdfParams {
    /// RFC 9106's second recommended choice, with one lane: 64 MiB, 3 passes.
    pub fn recommended() -> Self {
        Self {
            m: 64 * 1024,
            t: 3,
            p: 1,
            salt: Bytes(random::<16>().to_vec()),
        }
    }

    /// Cheap parameters for tests only.
    #[cfg(test)]
    pub fn cheap() -> Self {
        Self {
            m: 64,
            t: 1,
            p: 1,
            salt: Bytes(random::<16>().to_vec()),
        }
    }

    fn sane(&self) -> bool {
        // A header read from disk is checked: no zero-cost or absurd stretching.
        (8..=4 * 1024 * 1024).contains(&self.m)
            && (1..=64).contains(&self.t)
            && (1..=16).contains(&self.p)
            && self.salt.0.len() >= 16
            && (cfg!(test) || self.m >= 19 * 1024)
    }
}

/// The key that wraps the vault key: Argon2id(password), then HKDF with the
/// TPM's share mixed in, so a copy of the vault file is useless off this machine.
pub fn derive(password: &[u8], kdf: &KdfParams, tpm: Option<&[u8]>) -> Result<Key, String> {
    if !kdf.sane() {
        return Err("the vault's key parameters are not acceptable".into());
    }
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(KEY_LEN))
        .map_err(|e| format!("argon2 parameters: {e}"))?;
    let mut stretched = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password, &kdf.salt.0, stretched.as_mut())
        .map_err(|e| format!("argon2: {e}"))?;
    let mut ikm = Zeroizing::new(stretched.to_vec());
    if let Some(share) = tpm {
        ikm.extend_from_slice(share);
    }
    let hk = Hkdf::<Sha256>::new(Some(&kdf.salt.0), &ikm);
    let mut key = Key([0u8; KEY_LEN]);
    hk.expand(b"dashi-secretd kek v1", &mut key.0)
        .map_err(|_| "hkdf".to_string())?;
    Ok(key)
}

/// Something sealed: its nonce and the ciphertext with its tag.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sealed {
    pub nonce: Bytes,
    pub ct: Bytes,
}

pub fn seal(key: &Key, plaintext: &[u8], aad: &[u8]) -> Result<Sealed, String> {
    let cipher = XChaCha20Poly1305::new(key.as_bytes().into());
    let nonce = random::<24>();
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| "sealing failed".to_string())?;
    Ok(Sealed {
        nonce: Bytes(nonce.to_vec()),
        ct: Bytes(ct),
    })
}

/// Opens `sealed`; a wrong key, a changed byte, or other `aad` all fail the same way.
pub fn open(key: &Key, sealed: &Sealed, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if sealed.nonce.0.len() != 24 {
        return Err("the vault is damaged".into());
    }
    let cipher = XChaCha20Poly1305::new(key.as_bytes().into());
    cipher
        .decrypt(
            XNonce::from_slice(&sealed.nonce.0),
            Payload {
                msg: &sealed.ct.0,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| "wrong password, or the vault is damaged".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_opens_only_with_its_key_and_context() {
        let key = Key::random();
        let sealed = seal(&key, b"hunter2", b"ctx").unwrap();
        assert_eq!(open(&key, &sealed, b"ctx").unwrap().as_slice(), b"hunter2");
        assert!(open(&Key::random(), &sealed, b"ctx").is_err());
        assert!(open(&key, &sealed, b"other").is_err());
        let mut tampered = sealed.clone();
        tampered.ct.0[0] ^= 1;
        assert!(open(&key, &tampered, b"ctx").is_err());
        assert!(!sealed.ct.0.windows(7).any(|w| w == b"hunter2"));
    }

    #[test]
    fn the_password_and_the_tpm_share_both_matter() {
        let kdf = KdfParams::cheap();
        let a = derive(b"pw", &kdf, None).unwrap();
        assert_eq!(a.0, derive(b"pw", &kdf, None).unwrap().0);
        assert_ne!(a.0, derive(b"pW", &kdf, None).unwrap().0);
        assert_ne!(a.0, derive(b"pw", &kdf, Some(&[7; 32])).unwrap().0);
    }

    #[test]
    fn weak_parameters_from_disk_are_refused() {
        let mut kdf = KdfParams::cheap();
        kdf.salt = Bytes(vec![1; 4]);
        assert!(derive(b"pw", &kdf, None).is_err());
        let mut kdf = KdfParams::cheap();
        kdf.t = 0;
        assert!(derive(b"pw", &kdf, None).is_err());
    }

    #[test]
    fn keys_are_never_printed() {
        assert_eq!(format!("{:?}", Key::random()), "Key([redacted])");
    }
}
