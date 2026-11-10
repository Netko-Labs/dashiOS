//! What a token's placeholder name and the token itself may be.

use crate::vault::bytes::Secret;

const MAX_NAME: usize = 64;

/// A placeholder's name: lowercase letters, digits, and `-`, `_`, `.` after the first.
pub fn normalize_name(input: &str) -> Result<String, String> {
    let name = input.trim().to_ascii_lowercase();
    let mut chars = name.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let rest_ok =
        chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | '.'));
    if !first_ok || !rest_ok || name.len() > MAX_NAME {
        return Err("a token's name is letters, digits, '-', '_' and '.' (like github)".into());
    }
    Ok(name)
}

const MAX_TOKEN: usize = 8 * 1024;

/// A token goes into a header, so it is printable ASCII without spaces: no
/// line break can smuggle another header in.
pub(super) fn check_token(token: &Secret) -> Result<(), String> {
    let bytes = token.expose();
    if bytes.is_empty()
        || bytes.len() > MAX_TOKEN
        || !bytes.iter().all(|b| (0x21..=0x7e).contains(b))
    {
        return Err("a token is letters, digits and punctuation, without spaces".into());
    }
    Ok(())
}
