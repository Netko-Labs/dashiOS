//! Bytes as base64 in JSON: `Bytes` for what may be seen (nonces,
//! ciphertext), `Secret` for what may not: zeroed when dropped and never
//! printed, so a stray `{:?}` or log line can't leak it.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use zeroize::Zeroizing;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Bytes(pub Vec<u8>);

impl Serialize for Bytes {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        STANDARD
            .decode(text.as_bytes())
            .map(Bytes)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
pub struct Secret(pub Zeroizing<Vec<u8>>);

impl Secret {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn expose(&self) -> &[u8] {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl Serialize for Secret {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let text = Zeroizing::new(STANDARD.encode(self.0.as_slice()));
        s.serialize_str(&text)
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = Zeroizing::new(String::deserialize(d)?);
        STANDARD
            .decode(text.as_bytes())
            .map(Secret::new)
            .map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_round_trip_but_never_print() {
        let secret = Secret::new(b"hunter2".to_vec());
        let json = serde_json::to_string(&secret).unwrap();
        assert_eq!(json, "\"aHVudGVyMg==\"");
        let back: Secret = serde_json::from_str(&json).unwrap();
        assert_eq!(back.expose(), b"hunter2");
        assert_eq!(format!("{back:?}"), "Secret([redacted])");
    }
}
