//! One person's vault: a random vault key seals the body (every item); the
//! vault key is itself sealed by a key derived from the login password and,
//! where there is a TPM, a share only this machine's TPM can unseal. The file
//! is JSON: the header in the clear, the rest sealed (docs/secrets.md).

pub mod bytes;
pub mod crypto;
pub mod item;
pub mod store;
pub mod token;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use bytes::Bytes;
use crypto::{KdfParams, Key, Sealed};
pub use item::Data;

/// What keeps the TPM's share of the key: `systemd-creds` on a real
/// machine (tpm.rs), nothing at all where there is no TPM.
pub trait Sealer: Send + Sync {
    /// Seal `share`; None when this machine has nothing to seal it with.
    fn seal(&self, share: &[u8]) -> Result<Option<Vec<u8>>, String>;
    fn unseal(&self, blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, String>;
}

/// No TPM: the password alone protects the vault.
pub struct NoTpm;

impl Sealer for NoTpm {
    fn seal(&self, _share: &[u8]) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }
    fn unseal(&self, _blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("this vault needs the TPM it was made with".into())
    }
}

const FORMAT: &str = "dashi-vault";
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct File {
    format: String,
    version: u32,
    kdf: KdfParams,
    /// The TPM's share, sealed by the TPM (systemd-creds), when there is one.
    #[serde(default)]
    tpm: Option<Bytes>,
    /// The vault key, sealed by the key from the password (and the TPM's share).
    key: Sealed,
    body: Sealed,
}

pub struct Vault {
    uid: u32,
    kdf: KdfParams,
    tpm: Option<Bytes>,
    wrapped: Sealed,
    key: Key,
    pub data: Data,
}

fn key_aad(uid: u32) -> Vec<u8> {
    format!("dashi-vault v1 key uid={uid}").into_bytes()
}

fn body_aad(uid: u32) -> Vec<u8> {
    format!("dashi-vault v1 body uid={uid}").into_bytes()
}

/// The key-wrapping key for `password`, with the TPM's share when the vault has one.
fn wrapping_key(
    password: &[u8],
    kdf: &KdfParams,
    tpm: Option<&Bytes>,
    sealer: &dyn Sealer,
) -> Result<Key, String> {
    let share = tpm.map(|blob| sealer.unseal(&blob.0)).transpose()?;
    crypto::derive(password, kdf, share.as_ref().map(|s| s.as_slice()))
}

fn new_wrapping(
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

impl Vault {
    pub fn create(
        uid: u32,
        password: &[u8],
        kdf: KdfParams,
        sealer: &dyn Sealer,
        now: u64,
    ) -> Result<Self, String> {
        let key = Key::random();
        let (kdf, tpm, wrapped) = new_wrapping(uid, password, &key, kdf, sealer)?;
        let mut data = Data::default();
        data.ensure_default(now);
        Ok(Self {
            uid,
            kdf,
            tpm,
            wrapped,
            key,
            data,
        })
    }

    pub fn open(
        uid: u32,
        file: &[u8],
        password: &[u8],
        sealer: &dyn Sealer,
    ) -> Result<Self, String> {
        let file: File =
            serde_json::from_slice(file).map_err(|_| "the vault file is damaged".to_string())?;
        if file.format != FORMAT || file.version != VERSION {
            return Err("the vault file is from another version".into());
        }
        let wrapping = wrapping_key(password, &file.kdf, file.tpm.as_ref(), sealer)?;
        let raw = crypto::open(&wrapping, &file.key, &key_aad(uid))?;
        let key = Key(raw
            .as_slice()
            .try_into()
            .map_err(|_| "the vault file is damaged".to_string())?);
        let body = crypto::open(&key, &file.body, &body_aad(uid))?;
        let data: Data =
            serde_json::from_slice(&body).map_err(|_| "the vault's contents are damaged")?;
        Ok(Self {
            uid,
            kdf: file.kdf,
            tpm: file.tpm,
            wrapped: file.key,
            key,
            data,
        })
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, String> {
        let body = Zeroizing::new(serde_json::to_vec(&self.data).map_err(|e| e.to_string())?);
        let file = File {
            format: FORMAT.into(),
            version: VERSION,
            kdf: self.kdf.clone(),
            tpm: self.tpm.clone(),
            key: self.wrapped.clone(),
            body: crypto::seal(&self.key, &body, &body_aad(self.uid))?,
        };
        serde_json::to_vec(&file).map_err(|e| e.to_string())
    }

    /// Whether `password` opens this vault (the lock screen, a payment's check).
    pub fn verify(&self, password: &[u8], sealer: &dyn Sealer) -> bool {
        wrapping_key(password, &self.kdf, self.tpm.as_ref(), sealer)
            .and_then(|k| crypto::open(&k, &self.wrapped, &key_aad(self.uid)))
            .is_ok()
    }

    /// The login password changed: the same vault key, wrapped anew.
    pub fn change_password(
        &mut self,
        old: &[u8],
        new: &[u8],
        sealer: &dyn Sealer,
    ) -> Result<(), String> {
        if !self.verify(old, sealer) {
            return Err("the old password is wrong".into());
        }
        let salt = KdfParams {
            salt: Bytes(crypto::random::<16>().to_vec()),
            ..self.kdf.clone()
        };
        let (kdf, tpm, wrapped) = new_wrapping(self.uid, new, &self.key, salt, sealer)?;
        self.kdf = kdf;
        self.tpm = tpm;
        self.wrapped = wrapped;
        Ok(())
    }

    pub fn has_tpm(&self) -> bool {
        self.tpm.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::bytes::Secret;

    /// A stand-in TPM: "seals" by XOR with a fixed pad, so tests can tell it was used.
    struct FakeTpm;
    impl Sealer for FakeTpm {
        fn seal(&self, share: &[u8]) -> Result<Option<Vec<u8>>, String> {
            Ok(Some(share.iter().map(|b| b ^ 0x5a).collect()))
        }
        fn unseal(&self, blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
            Ok(Zeroizing::new(blob.iter().map(|b| b ^ 0x5a).collect()))
        }
    }

    fn sample(sealer: &dyn Sealer) -> Vec<u8> {
        let mut vault =
            Vault::create(1000, b"correct horse", KdfParams::cheap(), sealer, 1).unwrap();
        vault.data.app_secrets.insert(
            "org.example.App".into(),
            Secret::new(b"s3cr3t-value".to_vec()),
        );
        vault.to_bytes().unwrap()
    }

    #[test]
    fn the_file_holds_no_secret_in_the_clear() {
        let file = sample(&NoTpm);
        let text = String::from_utf8_lossy(&file);
        assert!(!text.contains("s3cr3t-value") && !text.contains("org.example.App"));
        assert!(!text.contains("correct horse"));
    }

    #[test]
    fn it_opens_with_the_password_only() {
        let file = sample(&NoTpm);
        let vault = Vault::open(1000, &file, b"correct horse", &NoTpm).unwrap();
        assert_eq!(
            vault.data.app_secrets["org.example.App"].expose(),
            b"s3cr3t-value"
        );
        assert!(Vault::open(1000, &file, b"wrong", &NoTpm).is_err());
        // Another person's vault, even with the right password, does not open as yours.
        assert!(Vault::open(1001, &file, b"correct horse", &NoTpm).is_err());
    }

    #[test]
    fn a_tpm_vault_needs_the_tpm() {
        let file = sample(&FakeTpm);
        assert!(Vault::open(1000, &file, b"correct horse", &FakeTpm).is_ok());
        assert!(Vault::open(1000, &file, b"correct horse", &NoTpm).is_err());
    }

    #[test]
    fn a_new_password_keeps_the_contents() {
        let file = sample(&FakeTpm);
        let mut vault = Vault::open(1000, &file, b"correct horse", &FakeTpm).unwrap();
        assert!(
            vault
                .change_password(b"nope", b"battery staple", &FakeTpm)
                .is_err()
        );
        vault
            .change_password(b"correct horse", b"battery staple", &FakeTpm)
            .unwrap();
        let file = vault.to_bytes().unwrap();
        assert!(Vault::open(1000, &file, b"correct horse", &FakeTpm).is_err());
        let vault = Vault::open(1000, &file, b"battery staple", &FakeTpm).unwrap();
        assert_eq!(vault.data.app_secrets.len(), 1);
    }

    #[test]
    fn a_changed_byte_is_refused() {
        let mut file = sample(&NoTpm);
        let at = file.len() - 10;
        file[at] = if file[at] == b'A' { b'B' } else { b'A' };
        assert!(Vault::open(1000, &file, b"correct horse", &NoTpm).is_err());
    }
}
