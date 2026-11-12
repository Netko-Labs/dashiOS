//! A vault in memory: made, opened from its file, written back, and re-wrapped for a new password.

use zeroize::Zeroizing;

use super::{
    Data, Sealer,
    bytes::Bytes,
    crypto::{self, KdfParams, Key, Sealed},
    file::{FORMAT, File, VERSION, body_aad, key_aad},
    wrapping::{new_wrapping, wrapping_key},
};

pub struct Vault {
    uid: u32,
    kdf: KdfParams,
    tpm: Option<Bytes>,
    wrapped: Sealed,
    key: Key,
    pub data: Data,
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
