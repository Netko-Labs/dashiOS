//! The vault, sealed and opened (tests with a fake TPM).

use zeroize::Zeroizing;

use super::{NoTpm, Sealer, Vault, bytes::Secret, crypto::KdfParams};

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
    let mut vault = Vault::create(1000, b"correct horse", KdfParams::cheap(), sealer, 1).unwrap();
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
