//! The TPM's part: what seals the machine's share of the key.

use zeroize::Zeroizing;

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
