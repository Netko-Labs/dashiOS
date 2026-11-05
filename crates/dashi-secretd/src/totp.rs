//! One-time codes (RFC 6238, TOTP over RFC 4226's HOTP), computed here so the
//! TOTP secret never leaves dashi-secretd: only the 6-digit code does, and only
//! to the shell's broker, which types it.

use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

use crate::vault::item::{Totp, TotpAlgorithm};

fn hmac<M: Mac + hmac::digest::KeyInit>(key: &[u8], counter: u64) -> Vec<u8> {
    let mut mac = <M as hmac::digest::KeyInit>::new_from_slice(key)
        .unwrap_or_else(|_| unreachable!("HMAC takes keys of any length"));
    mac.update(&counter.to_be_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// RFC 4226's HOTP: the counter's HMAC, truncated dynamically, `digits` long.
pub fn hotp(algorithm: TotpAlgorithm, key: &[u8], counter: u64, digits: u32) -> String {
    let digest = match algorithm {
        TotpAlgorithm::Sha1 => hmac::<Hmac<Sha1>>(key, counter),
        TotpAlgorithm::Sha256 => hmac::<Hmac<Sha256>>(key, counter),
        TotpAlgorithm::Sha512 => hmac::<Hmac<Sha512>>(key, counter),
    };
    let offset = usize::from(digest[digest.len() - 1] & 0x0f);
    let binary = u32::from_be_bytes([
        digest[offset] & 0x7f,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]);
    let digits = digits.clamp(6, 8);
    let code = u64::from(binary) % 10u64.pow(digits);
    format!("{code:0width$}", width = digits as usize)
}

/// The code for `unix_time`.
pub fn code(totp: &Totp, unix_time: u64) -> String {
    let period = totp.period.clamp(10, 300);
    hotp(
        totp.algorithm,
        totp.secret.expose(),
        unix_time / period,
        totp.digits,
    )
}

/// How many seconds the code for `unix_time` stays good.
pub fn remaining(totp: &Totp, unix_time: u64) -> u64 {
    let period = totp.period.clamp(10, 300);
    period - unix_time % period
}

/// RFC 4648 base32, as authenticator apps show secrets (spaces, lowercase and padding allowed).
pub fn base32_decode(text: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buffer: u64 = 0;
    let mut bits = 0;
    for c in text.chars().filter(|c| !c.is_whitespace() && *c != '-') {
        if c == '=' {
            continue;
        }
        let value = match c.to_ascii_uppercase() {
            c @ 'A'..='Z' => c as u64 - 'A' as u64,
            c @ '2'..='7' => c as u64 - '2' as u64 + 26,
            _ => return None,
        };
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    (!out.is_empty()).then_some(out)
}

/// An `otpauth://totp/...?secret=...` URI, or a bare base32 secret, to a TOTP.
pub fn parse(input: &str) -> Option<Totp> {
    use crate::vault::bytes::Secret;
    let input = input.trim();
    let Some(query) = input
        .strip_prefix("otpauth://totp/")
        .and_then(|rest| rest.split_once('?').map(|(_, q)| q))
    else {
        return base32_decode(input).map(|key| Totp {
            secret: Secret::new(key),
            digits: 6,
            period: 30,
            algorithm: TotpAlgorithm::Sha1,
        });
    };
    let mut totp = Totp {
        secret: Secret::default(),
        digits: 6,
        period: 30,
        algorithm: TotpAlgorithm::Sha1,
    };
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        match key {
            "secret" => totp.secret = Secret::new(base32_decode(value)?),
            "digits" => totp.digits = value.parse().ok().filter(|d| (6..=8).contains(d))?,
            "period" => totp.period = value.parse().ok().filter(|p| (10..=300).contains(p))?,
            "algorithm" => {
                totp.algorithm = match value.to_ascii_uppercase().as_str() {
                    "SHA1" => TotpAlgorithm::Sha1,
                    "SHA256" => TotpAlgorithm::Sha256,
                    "SHA512" => TotpAlgorithm::Sha512,
                    _ => return None,
                }
            }
            _ => {}
        }
    }
    (!totp.secret.expose().is_empty()).then_some(totp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::bytes::Secret;

    fn rfc(algorithm: TotpAlgorithm, seed: &[u8]) -> Totp {
        Totp {
            secret: Secret::new(seed.to_vec()),
            digits: 8,
            period: 30,
            algorithm,
        }
    }

    /// RFC 6238, Appendix B: every time, every algorithm.
    #[test]
    fn rfc_6238_test_vectors() {
        let sha1 = rfc(TotpAlgorithm::Sha1, b"12345678901234567890");
        let sha256 = rfc(TotpAlgorithm::Sha256, b"12345678901234567890123456789012");
        let sha512 = rfc(
            TotpAlgorithm::Sha512,
            b"1234567890123456789012345678901234567890123456789012345678901234",
        );
        let vectors: [(u64, &str, &str, &str); 6] = [
            (59, "94287082", "46119246", "90693936"),
            (1111111109, "07081804", "68084774", "25091201"),
            (1111111111, "14050471", "67062674", "99943326"),
            (1234567890, "89005924", "91819424", "93441116"),
            (2000000000, "69279037", "90698825", "38618901"),
            (20000000000, "65353130", "77737706", "47863826"),
        ];
        for (time, one, two, five) in vectors {
            assert_eq!(code(&sha1, time), one, "SHA1 at {time}");
            assert_eq!(code(&sha256, time), two, "SHA256 at {time}");
            assert_eq!(code(&sha512, time), five, "SHA512 at {time}");
        }
    }

    /// RFC 4226, Appendix D: HOTP's own vectors.
    #[test]
    fn rfc_4226_test_vectors() {
        let expected = [
            "755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583",
            "399871", "520489",
        ];
        for (counter, want) in expected.iter().enumerate() {
            let got = hotp(
                TotpAlgorithm::Sha1,
                b"12345678901234567890",
                counter as u64,
                6,
            );
            assert_eq!(&got, want);
        }
    }

    #[test]
    fn secrets_come_as_base32_or_otpauth_uris() {
        assert_eq!(
            base32_decode("GEZDGNBV GY3TQOJQ").unwrap(),
            b"1234567890".to_vec()
        );
        assert_eq!(base32_decode("not base32!"), None);
        let totp = parse("otpauth://totp/GitHub:alexk?secret=GEZDGNBVGY3TQOJQ&issuer=GitHub&digits=8&algorithm=SHA256").unwrap();
        assert_eq!(totp.digits, 8);
        assert_eq!(totp.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(totp.secret.expose(), b"1234567890");
        assert!(parse("otpauth://totp/x?digits=6").is_none());
        assert_eq!(remaining(&parse("GEZDGNBV").unwrap(), 59), 1);
    }
}
