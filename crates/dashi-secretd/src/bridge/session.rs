//! Secret Service sessions: how secrets cross the bus. "plain" as is, or
//! "dh-ietf1024-sha256-aes128-cbc-pkcs7": a Diffie-Hellman exchange over RFC
//! 2409's 1024-bit group, HKDF-SHA256 to a 128-bit AES key, then AES-CBC with
//! PKCS#7 (what libsecret asks for first). Each session belongs to the bus
//! connection that opened it.

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use hkdf::Hkdf;
use num_bigint::BigUint;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::vault::{bytes::Secret, crypto};

/// RFC 2409, 6.2: the Second Oakley Group's prime; the generator is 2.
const PRIME: &str = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF";
const BYTES: usize = 128;

pub const PLAIN: &str = "plain";
pub const DH: &str = "dh-ietf1024-sha256-aes128-cbc-pkcs7";

pub enum Algorithm {
    Plain,
    Aes(Zeroizing<[u8; 16]>),
}

pub struct Session {
    pub owner: String,
    pub algorithm: Algorithm,
}

fn prime() -> BigUint {
    BigUint::parse_bytes(PRIME.as_bytes(), 16)
        .unwrap_or_else(|| unreachable!("the prime is a constant"))
}

fn padded(n: &BigUint) -> Vec<u8> {
    let bytes = n.to_bytes_be();
    let mut out = vec![0u8; BYTES.saturating_sub(bytes.len())];
    out.extend_from_slice(&bytes);
    out
}

/// Our half of the exchange for the client's public key: (our public key, the AES key).
pub fn negotiate(client_public: &[u8]) -> Result<(Vec<u8>, Zeroizing<[u8; 16]>), String> {
    let p = prime();
    let theirs = BigUint::from_bytes_be(client_public);
    let one = BigUint::from(1u32);
    // A public key of 0, 1 or p-1 (or out of range) would make the secret guessable.
    if theirs <= one || theirs >= &p - &one {
        return Err("that public key is not acceptable".into());
    }
    let private = BigUint::from_bytes_be(Zeroizing::new(crypto::random::<BYTES>()).as_slice());
    let ours = BigUint::from(2u32).modpow(&private, &p);
    let shared = Zeroizing::new(padded(&theirs.modpow(&private, &p)));
    let mut key = Zeroizing::new([0u8; 16]);
    Hkdf::<Sha256>::new(None, &shared)
        .expand(&[], key.as_mut())
        .map_err(|_| "hkdf".to_string())?;
    Ok((padded(&ours), key))
}

impl Algorithm {
    /// A secret for the wire: (parameters, value).
    pub fn encrypt(&self, secret: &Secret) -> (Vec<u8>, Vec<u8>) {
        match self {
            Algorithm::Plain => (Vec::new(), secret.expose().to_vec()),
            Algorithm::Aes(key) => {
                let iv = crypto::random::<16>();
                let value = cbc::Encryptor::<aes::Aes128>::new(key.as_ref().into(), &iv.into())
                    .encrypt_padded_vec_mut::<Pkcs7>(secret.expose());
                (iv.to_vec(), value)
            }
        }
    }

    pub fn decrypt(&self, parameters: &[u8], value: &[u8]) -> Result<Secret, String> {
        match self {
            Algorithm::Plain => Ok(Secret::new(value.to_vec())),
            Algorithm::Aes(key) => {
                let iv: [u8; 16] = parameters
                    .try_into()
                    .map_err(|_| "a secret without its IV")?;
                cbc::Decryptor::<aes::Aes128>::new(key.as_ref().into(), &iv.into())
                    .decrypt_padded_vec_mut::<Pkcs7>(value)
                    .map(Secret::new)
                    .map_err(|_| "a secret that doesn't decrypt".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_ends_agree_on_the_key_and_secrets_cross() {
        let p = prime();
        let client_private = BigUint::from_bytes_be(&crypto::random::<BYTES>());
        let client_public = BigUint::from(2u32).modpow(&client_private, &p);
        let (server_public, key) = negotiate(&padded(&client_public)).unwrap();
        let shared = padded(&BigUint::from_bytes_be(&server_public).modpow(&client_private, &p));
        let mut client_key = [0u8; 16];
        Hkdf::<Sha256>::new(None, &shared)
            .expand(&[], &mut client_key)
            .unwrap();
        assert_eq!(&client_key, key.as_ref());
        let aes = Algorithm::Aes(key);
        let (iv, value) = aes.encrypt(&Secret::new(b"hunter2".to_vec()));
        assert_ne!(value, b"hunter2");
        assert_eq!(aes.decrypt(&iv, &value).unwrap().expose(), b"hunter2");
        assert!(aes.decrypt(&[0; 3], &value).is_err());
    }

    #[test]
    fn degenerate_public_keys_are_refused() {
        assert!(negotiate(&[1]).is_err());
        assert!(negotiate(&[0]).is_err());
        assert!(negotiate(&padded(&(prime() - BigUint::from(1u32)))).is_err());
    }
}
