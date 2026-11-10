//! A token's placeholder name.

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
