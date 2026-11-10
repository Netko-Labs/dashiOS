//! What a token itself may be.

use crate::vault::bytes::Secret;

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
