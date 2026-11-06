//! The login keyring, imported once: gnome-keyring's
//! `~/.local/share/keyrings/login.keyring` (its binary format, version 0:
//! AES-128-CBC under a key from iterated SHA-256 of the login password and a
//! salt, an MD5 check over the plaintext; gkm-secret-binary.c). The PAM helper
//! reads the file as root at the first login after the upgrade and hands it
//! over with the password; every item lands in the default collection, with
//! its attributes. The file itself is left where it was.

use std::collections::BTreeMap;

use aes::cipher::{BlockDecryptMut, KeyIvInit, block_padding::NoPadding};
use md5::{Digest, Md5};
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::vault::{Data, bytes::Secret, item::SecretItem};

pub const LOGIN_KEYRING: &str = "gnome-keyring:login";
const MAGIC: &[u8; 16] = b"GnomeKeyring\n\r\0\n";

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .at
            .checked_add(n)
            .filter(|end| *end <= self.bytes.len());
        let end = end.ok_or("the keyring file is cut short")?;
        let out = &self.bytes[self.at..end];
        self.at = end;
        Ok(out)
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn time(&mut self) -> Result<u64, String> {
        Ok((u64::from(self.u32()?) << 32) | u64::from(self.u32()?))
    }
    fn string(&mut self) -> Result<Option<Vec<u8>>, String> {
        let len = self.u32()?;
        if len == u32::MAX {
            return Ok(None);
        }
        Ok(Some(self.take(len as usize)?.to_vec()))
    }
    fn text(&mut self) -> Result<String, String> {
        Ok(self
            .string()?
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default())
    }
    fn attributes(&mut self) -> Result<BTreeMap<String, String>, String> {
        let count = self.u32()?;
        let mut out = BTreeMap::new();
        for _ in 0..count.min(4096) {
            let name = self.text()?;
            let value = match self.u32()? {
                0 => self.text()?,
                1 => self.u32()?.to_string(),
                _ => return Err("an attribute of an unknown type".into()),
            };
            out.insert(name, value);
        }
        Ok(out)
    }
}

/// egg_symkey_generate_simple with SHA-256 and AES-128: key and IV from one pass.
fn derive(password: &[u8], salt: &[u8], iterations: u32) -> (Zeroizing<[u8; 16]>, [u8; 16]) {
    let mut digest: [u8; 32] = Sha256::new()
        .chain_update(password)
        .chain_update(salt)
        .finalize()
        .into();
    for _ in 1..iterations.max(1) {
        digest = Sha256::digest(digest).into();
    }
    let mut key = Zeroizing::new([0u8; 16]);
    key.copy_from_slice(&digest[..16]);
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&digest[16..]);
    zeroize::Zeroize::zeroize(&mut digest);
    (key, iv)
}

fn schema_for(kind: u32) -> &'static str {
    match kind {
        1 => "org.gnome.keyring.NetworkPassword",
        2 => "org.gnome.keyring.Note",
        3 => "org.gnome.keyring.ChainedKeyring",
        4 => "org.gnome.keyring.EncryptionKey",
        _ => "org.freedesktop.Secret.Generic",
    }
}

/// Decrypt `file` with `password` and add its items to `data`; how many came in.
pub fn import_login_keyring(
    data: &mut Data,
    file: &[u8],
    password: &[u8],
    now: u64,
) -> Result<usize, String> {
    let mut r = Reader { bytes: file, at: 0 };
    if r.take(16)? != MAGIC {
        return Err("not a gnome-keyring file".into());
    }
    if r.take(4)? != [0, 0, 0, 0] {
        return Err("a gnome-keyring file of another version".into());
    }
    r.string()?; // the keyring's name
    r.time()?;
    r.time()?;
    r.u32()?; // flags
    r.u32()?; // lock timeout
    let iterations = r.u32()?;
    let salt = r.take(8)?.to_vec();
    for _ in 0..4 {
        r.u32()?;
    }
    let count = r.u32()?.min(100_000);
    let mut kinds = Vec::new();
    for _ in 0..count {
        r.u32()?; // id
        kinds.push(r.u32()?);
        r.attributes()?; // hashed, of no use here
    }
    let size = r.u32()? as usize;
    if !size.is_multiple_of(16) || size < 16 {
        return Err("the keyring's sealed part is damaged".into());
    }
    let mut sealed = Zeroizing::new(r.take(size)?.to_vec());
    let (key, iv) = derive(password, &salt, iterations);
    let plain = cbc::Decryptor::<aes::Aes128>::new(key.as_ref().into(), &iv.into())
        .decrypt_padded_mut::<NoPadding>(&mut sealed)
        .map_err(|_| "the keyring's sealed part is damaged")?;
    if Md5::digest(&plain[16..]).as_slice() != &plain[..16] {
        return Err("the login keyring doesn't open with this password".into());
    }
    let mut r = Reader {
        bytes: &plain[16..],
        at: 0,
    };
    data.ensure_default(now);
    // All of it or nothing: a damaged item leaves the vault as it was.
    let mut items = Vec::new();
    for kind in kinds {
        let label = r.text()?;
        let secret = Secret::new(r.string()?.unwrap_or_default());
        let created = r.time()?;
        let modified = r.time()?;
        r.string()?;
        for _ in 0..4 {
            r.u32()?;
        }
        let mut attributes = r.attributes()?;
        let acl = r.u32()?;
        for _ in 0..acl.min(4096) {
            r.u32()?;
            r.string()?;
            r.string()?;
            r.string()?;
            r.u32()?;
        }
        attributes
            .entry("xdg:schema".into())
            .or_insert_with(|| schema_for(kind).into());
        items.push(SecretItem {
            id: 0,
            collection: "login".into(),
            label,
            attributes,
            secret,
            content_type: "text/plain".into(),
            created,
            modified,
        });
    }
    let imported = items.len();
    for mut item in items {
        item.id = data.next_id();
        data.items.push(item);
    }
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use aes::cipher::BlockEncryptMut;

    use super::*;

    fn put_u32(out: &mut Vec<u8>, v: u32) {
        out.extend_from_slice(&v.to_be_bytes());
    }
    fn put_str(out: &mut Vec<u8>, s: &[u8]) {
        put_u32(out, s.len() as u32);
        out.extend_from_slice(s);
    }
    fn put_attrs(out: &mut Vec<u8>, attrs: &[(&str, &str)]) {
        put_u32(out, attrs.len() as u32);
        for (k, v) in attrs {
            put_str(out, k.as_bytes());
            put_u32(out, 0);
            put_str(out, v.as_bytes());
        }
    }

    /// A login keyring as gnome-keyring writes one, with one item.
    fn keyring(password: &[u8]) -> Vec<u8> {
        let salt = [9u8; 8];
        let mut out = MAGIC.to_vec();
        out.extend_from_slice(&[0, 0, 0, 0]);
        put_str(&mut out, b"Login");
        out.extend_from_slice(&[0; 16]); // ctime, mtime
        put_u32(&mut out, 0);
        put_u32(&mut out, 0);
        put_u32(&mut out, 3); // iterations
        out.extend_from_slice(&salt);
        out.extend_from_slice(&[0; 16]);
        put_u32(&mut out, 1);
        put_u32(&mut out, 7);
        put_u32(&mut out, 0);
        put_attrs(&mut out, &[("service", "0123abcd")]);
        let mut plain = vec![0u8; 16];
        put_str(&mut plain, b"Chrome Safe Storage");
        put_str(&mut plain, b"chrome-key-123");
        plain.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 6]);
        put_u32(&mut plain, u32::MAX);
        plain.extend_from_slice(&[0; 16]);
        put_attrs(
            &mut plain,
            &[
                ("application", "chrome"),
                ("xdg:schema", "chrome_libsecret_os_crypt_password_v2"),
            ],
        );
        put_u32(&mut plain, 0);
        while !plain.len().is_multiple_of(16) {
            plain.push(0);
        }
        let hash = Md5::digest(&plain[16..]);
        plain[..16].copy_from_slice(&hash);
        let (key, iv) = derive(password, &salt, 3);
        let len = plain.len();
        cbc::Encryptor::<aes::Aes128>::new(key.as_ref().into(), &iv.into())
            .encrypt_padded_mut::<NoPadding>(&mut plain, len)
            .unwrap();
        put_u32(&mut out, len as u32);
        out.extend_from_slice(&plain);
        out
    }

    #[test]
    fn the_login_keyring_comes_in_with_the_login_password() {
        let file = keyring(b"correct horse");
        let mut data = Data::default();
        assert_eq!(
            import_login_keyring(&mut data, &file, b"correct horse", 1),
            Ok(1)
        );
        let item = &data.items[0];
        assert_eq!(item.label, "Chrome Safe Storage");
        assert_eq!(item.secret.expose(), b"chrome-key-123");
        assert_eq!(item.attributes["application"], "chrome");
        assert_eq!(item.collection, "login");
        assert_eq!((item.created, item.modified), (5, 6));
    }

    #[test]
    fn a_wrong_password_or_a_damaged_file_imports_nothing() {
        let file = keyring(b"correct horse");
        let mut data = Data::default();
        assert!(import_login_keyring(&mut data, &file, b"wrong", 1).is_err());
        assert!(
            import_login_keyring(&mut data, &file[..file.len() - 3], b"correct horse", 1).is_err()
        );
        assert!(import_login_keyring(&mut data, b"not a keyring at all", b"x", 1).is_err());
        assert!(data.items.is_empty());
    }
}
