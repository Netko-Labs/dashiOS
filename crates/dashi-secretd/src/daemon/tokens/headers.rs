//! The headers a token goes in: checked, tidied and kept to a few.

const MAX_HEADER: usize = 256;
/// The headers one item may go in (a provider's SDKs send one of a few).
const MAX_HEADERS: usize = 4;

/// "Name: value with {}" checked and tidied: a header name, and exactly one `{}`.
pub fn normalize_header(input: &str) -> Result<String, String> {
    let bad = || {
        "the header is a name, a colon, and where the token goes as {} (Authorization: Bearer {})"
            .to_string()
    };
    let (name, value) = input.split_once(':').ok_or_else(bad)?;
    let (name, value) = (name.trim(), value.trim());
    let name_ok = !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    let value_ok = value.matches("{}").count() == 1
        && value.chars().all(|c| (' '..='~').contains(&c))
        && value.len() <= MAX_HEADER;
    if !name_ok || !value_ok {
        return Err(bad());
    }
    Ok(format!("{name}: {value}"))
}

/// The headers an item names, from `headers` (or one `header`, as before
/// there could be more): each checked, 1 to MAX_HEADERS, no header name twice.
/// None when neither was sent.
pub fn headers_of(
    header: Option<&str>,
    headers: Option<&[String]>,
) -> Result<Option<Vec<String>>, String> {
    let given: Vec<&str> = match (headers, header) {
        (Some(list), _) => list.iter().map(String::as_str).collect(),
        (None, Some(one)) => vec![one],
        (None, None) => return Ok(None),
    };
    if given.is_empty() || given.len() > MAX_HEADERS {
        return Err(format!("a token goes in 1 to {MAX_HEADERS} headers"));
    }
    let mut out: Vec<String> = Vec::new();
    for each in given {
        let header = normalize_header(each)?;
        let name = |h: &str| h.split(':').next().unwrap_or("").to_ascii_lowercase();
        if out.iter().any(|known| name(known) == name(&header)) {
            return Err(format!("{} is named twice", name(&header)));
        }
        out.push(header);
    }
    Ok(Some(out))
}
