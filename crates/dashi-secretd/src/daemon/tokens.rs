//! API tokens (docs/secrets.md, "Tokens that stay home"): kept with the hosts
//! they are for and the header they go in, listed without the token, and
//! handed out only for a request to one of those hosts. The shell's token
//! proxy asks (`token {name, host}`); agents never reach this at all.

use serde_json::json;

use super::{protocol::Request, reply::Reply};
use crate::vault::{
    Vault,
    bytes::Secret,
    token::{DEFAULT_HEADER, Token},
};

const MAX_TOKENS: usize = 1_000;
const MAX_HOSTS: usize = 32;
const MAX_NAME: usize = 64;
const MAX_HEADER: usize = 256;
/// The headers one item may go in (a provider's SDKs send one of a few).
const MAX_HEADERS: usize = 4;
const MAX_TOKEN: usize = 8 * 1024;
/// A token's last use is written at most this often (the proxy asks per request).
const USE_GRAIN: u64 = 60;

pub fn owns(request: &Request) -> bool {
    matches!(
        request,
        Request::Tokens {}
            | Request::SaveToken { .. }
            | Request::UpdateToken { .. }
            | Request::DeleteToken { .. }
            | Request::Token { .. }
    )
}

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

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// A host as typed ("https://API.GitHub.com/v3") to the name it lists
/// ("api.github.com"); "*.example.com" lists every host under example.com
/// (not example.com itself). None for anything else.
pub fn normalize_host(input: &str) -> Option<String> {
    let trimmed = input.trim();
    let rest = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = rest.split(['/', '?', '#']).next()?;
    let host = host.rsplit_once('@').map(|(_, h)| h).unwrap_or(host);
    let host = host.split(':').next()?.trim_end_matches('.');
    let host = host.to_ascii_lowercase();
    let (wild, name) = match host.strip_prefix("*.") {
        Some(name) => (true, name),
        None => (false, host.as_str()),
    };
    let labels: Vec<&str> = name.split('.').collect();
    let valid = name.len() <= 253 && labels.len() >= 2 && labels.iter().all(|l| valid_label(l));
    valid.then(|| {
        if wild {
            format!("*.{name}")
        } else {
            name.into()
        }
    })
}

/// Whether a request to `host` may carry a token listed for `hosts`: the
/// same host, or one under a "*." entry. Nothing else: not a parent, not a
/// look-alike, not an address that merely ends the same.
pub fn host_listed(hosts: &[String], host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalize_host(&host).as_deref() != Some(host.as_str()) || host.starts_with("*.") {
        return false;
    }
    hosts.iter().any(|listed| match listed.strip_prefix("*.") {
        Some(suffix) => host.ends_with(&format!(".{suffix}")),
        None => *listed == host,
    })
}

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

/// A token goes into a header, so it is printable ASCII without spaces: no
/// line break can smuggle another header in.
fn check_token(token: &Secret) -> Result<(), String> {
    let bytes = token.expose();
    if bytes.is_empty()
        || bytes.len() > MAX_TOKEN
        || !bytes.iter().all(|b| (0x21..=0x7e).contains(b))
    {
        return Err("a token is letters, digits and punctuation, without spaces".into());
    }
    Ok(())
}

fn hosts_of(input: &[String]) -> Result<Vec<String>, String> {
    let mut hosts = Vec::new();
    for entry in input {
        let host = normalize_host(entry).ok_or_else(|| format!("“{entry}” is not a host name"))?;
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    if hosts.is_empty() || hosts.len() > MAX_HOSTS {
        return Err(format!("a token is for 1 to {MAX_HOSTS} hosts"));
    }
    Ok(hosts)
}

fn item(vault: &mut Vault, id: u64) -> Result<&mut Token, String> {
    vault
        .data
        .tokens
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "no such token".into())
}

pub fn handle(vault: &mut Vault, request: Request, now: u64) -> Result<(Reply, bool), String> {
    match request {
        Request::Tokens {} => {
            let mut tokens: Vec<_> = vault.data.tokens.iter().map(Token::summary).collect();
            tokens.sort_by(|a, b| a.name.cmp(&b.name));
            Ok((Reply::Plain(json!({ "tokens": tokens })), false))
        }
        Request::SaveToken {
            name,
            hosts,
            header,
            headers,
            token,
        } => {
            let name = normalize_name(&name)?;
            let hosts = hosts_of(&hosts)?;
            let headers = headers_of(header.as_deref(), headers.as_deref())?
                .unwrap_or_else(|| vec![DEFAULT_HEADER.to_string()]);
            check_token(&token)?;
            if vault.data.tokens.iter().any(|t| t.name == name) {
                return Err(format!("there is a token named {name} already"));
            }
            if vault.data.tokens.len() >= MAX_TOKENS {
                return Err("the vault is full".into());
            }
            let id = vault.data.next_id();
            let mut item = Token {
                id,
                name,
                hosts,
                header: String::new(),
                headers: Vec::new(),
                token,
                created: now,
                modified: now,
                last_used: None,
            };
            item.set_headers(headers);
            vault.data.tokens.push(item);
            Ok((Reply::Plain(json!({ "id": id })), true))
        }
        Request::UpdateToken {
            id,
            hosts,
            header,
            headers,
            token,
        } => {
            let hosts = hosts.as_deref().map(hosts_of).transpose()?;
            let headers = headers_of(header.as_deref(), headers.as_deref())?;
            // An empty token keeps the one there.
            let token = token.filter(|t| !t.expose().is_empty());
            if let Some(token) = &token {
                check_token(token)?;
            }
            let item = item(vault, id)?;
            if let Some(hosts) = hosts {
                item.hosts = hosts;
            }
            if let Some(headers) = headers {
                item.set_headers(headers);
            }
            if let Some(token) = token {
                item.token = token;
            }
            item.modified = now;
            Ok((Reply::ok(), true))
        }
        Request::DeleteToken { id } => {
            let before = vault.data.tokens.len();
            vault.data.tokens.retain(|t| t.id != id);
            Ok((Reply::ok(), before != vault.data.tokens.len()))
        }
        Request::Token { name, host } => {
            let name = normalize_name(&name)?;
            let item = vault
                .data
                .tokens
                .iter_mut()
                .find(|t| t.name == name)
                .ok_or("no such token")?;
            if !host_listed(&item.hosts, &host) {
                return Err(format!("{name} isn't for that host"));
            }
            let changed = item.last_used.is_none_or(|at| at + USE_GRAIN <= now);
            if changed {
                item.last_used = Some(now);
            }
            Ok((
                Reply::Secret {
                    fields: json!({ "name": item.name, "header": item.header, "headers": item.all_headers() }),
                    key: "token",
                    secret: item.token.clone(),
                },
                changed,
            ))
        }
        _ => Err("unknown request".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        daemon::reply::Reply,
        vault::{NoTpm, crypto::KdfParams},
    };
    use serde_json::Value;

    fn vault() -> Vault {
        Vault::create(1000, b"correct horse", KdfParams::cheap(), &NoTpm, 1).unwrap()
    }

    fn ask(vault: &mut Vault, request: Value, now: u64) -> Result<Value, String> {
        let request: Request = serde_json::from_value(request).map_err(|e| e.to_string())?;
        let (reply, _) = handle(vault, request, now)?;
        Ok(serde_json::from_str(&Reply::line(Ok(reply))).unwrap())
    }

    const GH: &str = "Z2hwX3Rlc3R0b2tlbg=="; // ghp_testtoken

    fn github(vault: &mut Vault) -> u64 {
        ask(
            vault,
            json!({ "op": "save-token", "name": "GitHub", "hosts": ["https://API.GitHub.com/", "*.githubusercontent.com"], "token": GH }),
            10,
        )
        .unwrap()["id"]
            .as_u64()
            .unwrap()
    }

    #[test]
    fn hosts_match_exactly_or_under_a_wildcard() {
        let hosts = vec!["api.github.com".to_string(), "*.example.com".to_string()];
        assert!(host_listed(&hosts, "api.github.com"));
        assert!(host_listed(&hosts, "API.GitHub.com."));
        assert!(host_listed(&hosts, "a.b.example.com"));
        // Not the parent, a sibling, a look-alike, or a suffix that isn't a label.
        assert!(!host_listed(&hosts, "github.com"));
        assert!(!host_listed(&hosts, "uploads.github.com"));
        assert!(!host_listed(&hosts, "api.github.com.evil.example"));
        assert!(!host_listed(&hosts, "evilexample.com"));
        assert!(!host_listed(&hosts, "example.com"));
        // Only a host name is asked about, never a pattern or an address with a path.
        assert!(!host_listed(&hosts, "*.example.com"));
        assert!(!host_listed(&hosts, "api.github.com/x"));
        assert!(!host_listed(&hosts, ""));
    }

    #[test]
    fn hosts_and_headers_are_checked_and_tidied() {
        assert_eq!(
            normalize_host("https://API.GitHub.com:443/v3").as_deref(),
            Some("api.github.com")
        );
        assert_eq!(
            normalize_host("*.Example.com").as_deref(),
            Some("*.example.com")
        );
        assert_eq!(normalize_host("www.x.com").as_deref(), Some("www.x.com"));
        // A wildcard over a whole top-level domain, or no domain at all, isn't a host.
        assert_eq!(normalize_host("*.com"), None);
        assert_eq!(normalize_host("localhost"), None);
        assert_eq!(normalize_host("a..b"), None);
        assert_eq!(normalize_host("bad host.com"), None);
        assert_eq!(
            normalize_header("x-api-key:{}").unwrap(),
            "x-api-key: {}".to_string()
        );
        assert!(normalize_header("Authorization: Bearer").is_err());
        assert!(normalize_header("Authorization: {} {}").is_err());
        assert!(normalize_header("Bad Name: {}").is_err());
        assert!(normalize_header("X: {}\r\nEvil: 1").is_err());
        assert!(normalize_name("-x").is_err() && normalize_name("a b").is_err());
        assert_eq!(normalize_name(" GitHub ").unwrap(), "github");
    }

    #[test]
    fn a_token_is_given_only_for_a_listed_host() {
        let mut v = vault();
        github(&mut v);
        let reply = ask(
            &mut v,
            json!({ "op": "token", "name": "github", "host": "api.github.com" }),
            20,
        )
        .unwrap();
        assert_eq!(reply["token"], GH);
        assert_eq!(reply["header"], "Authorization: Bearer {}");
        let raw = ask(
            &mut v,
            json!({ "op": "token", "name": "github", "host": "raw.githubusercontent.com" }),
            20,
        )
        .unwrap();
        assert_eq!(raw["token"], GH);
        // An unlisted host gets nothing: no token, and no hint of it.
        for host in [
            "github.com",
            "evil.example",
            "api.github.com.evil.example",
            "",
        ] {
            let error = ask(
                &mut v,
                json!({ "op": "token", "name": "github", "host": host }),
                20,
            )
            .unwrap_err();
            assert!(
                !error.contains("Z2hw") && !error.contains("ghp_"),
                "{error}"
            );
        }
        assert!(
            ask(
                &mut v,
                json!({ "op": "token", "name": "gitlab", "host": "api.github.com" }),
                20
            )
            .is_err()
        );
    }

    #[test]
    fn tokens_are_listed_without_the_token() {
        let mut v = vault();
        let id = github(&mut v);
        let listed = ask(&mut v, json!({ "op": "tokens" }), 30).unwrap();
        let text = listed.to_string();
        assert!(!text.contains(GH) && !text.contains("ghp_testtoken"));
        assert_eq!(listed["tokens"][0]["id"], id);
        assert_eq!(listed["tokens"][0]["name"], "github");
        assert_eq!(
            listed["tokens"][0]["hosts"],
            json!(["api.github.com", "*.githubusercontent.com"])
        );
        // Nor in the vault's own debug print.
        assert!(!format!("{:?}", v.data.tokens).contains("ghp_"));
    }

    #[test]
    fn a_token_is_edited_and_deleted() {
        let mut v = vault();
        let id = github(&mut v);
        // The same name twice is refused.
        assert!(
            ask(
                &mut v,
                json!({ "op": "save-token", "name": "github", "hosts": ["x.com"], "token": GH }),
                11
            )
            .is_err()
        );
        ask(
            &mut v,
            json!({ "op": "update-token", "id": id, "hosts": ["uploads.github.com"], "header": "X-Token: {}", "token": "" }),
            40,
        )
        .unwrap();
        let reply = ask(
            &mut v,
            json!({ "op": "token", "name": "github", "host": "uploads.github.com" }),
            41,
        )
        .unwrap();
        // An empty token kept the old one.
        assert_eq!(reply["token"], GH);
        assert_eq!(reply["header"], "X-Token: {}");
        assert!(
            ask(
                &mut v,
                json!({ "op": "token", "name": "github", "host": "api.github.com" }),
                41
            )
            .is_err()
        );
        ask(&mut v, json!({ "op": "delete-token", "id": id }), 50).unwrap();
        assert!(v.data.tokens.is_empty());
    }

    #[test]
    fn a_token_that_could_break_a_header_is_refused() {
        let mut v = vault();
        for token in ["", "dGVzdCB0b2tlbg==", "dG9rZW4NCkV2aWw6IDE="] {
            // "", "test token", "token\r\nEvil: 1"
            assert!(
                ask(
                    &mut v,
                    json!({ "op": "save-token", "name": "x", "hosts": ["x.com"], "token": token }),
                    1
                )
                .is_err(),
                "{token}"
            );
        }
        assert!(
            ask(
                &mut v,
                json!({ "op": "save-token", "name": "x", "hosts": [], "token": GH }),
                1
            )
            .is_err()
        );
        assert!(v.data.tokens.is_empty());
    }

    #[test]
    fn a_token_may_go_in_more_than_one_header() {
        let mut v = vault();
        ask(
            &mut v,
            json!({ "op": "save-token", "name": "anthropic", "hosts": ["api.anthropic.com"], "headers": ["x-api-key:{}", "Authorization: Bearer {}"], "token": GH }),
            1,
        )
        .unwrap();
        let listed = ask(&mut v, json!({ "op": "tokens" }), 2).unwrap();
        assert_eq!(
            listed["tokens"][0]["headers"],
            json!(["x-api-key: {}", "Authorization: Bearer {}"])
        );
        // The first is `header` too, for a reader that knows one.
        assert_eq!(listed["tokens"][0]["header"], "x-api-key: {}");
        let reply = ask(
            &mut v,
            json!({ "op": "token", "name": "anthropic", "host": "api.anthropic.com" }),
            3,
        )
        .unwrap();
        assert_eq!(
            reply["headers"],
            json!(["x-api-key: {}", "Authorization: Bearer {}"])
        );
        // A header name twice, none, or too many is refused.
        for headers in [
            json!(["X-Key: {}", "x-key: Bearer {}"]),
            json!([]),
            json!(["A: {}", "B: {}", "C: {}", "D: {}", "E: {}"]),
        ] {
            assert!(
                ask(
                    &mut v,
                    json!({ "op": "save-token", "name": "y", "hosts": ["y.com"], "headers": headers, "token": GH }),
                    4
                )
                .is_err()
            );
        }
        // One header again, as before.
        let id = v.data.tokens[0].id;
        ask(
            &mut v,
            json!({ "op": "update-token", "id": id, "header": "X-Token: {}" }),
            5,
        )
        .unwrap();
        assert_eq!(v.data.tokens[0].all_headers(), vec!["X-Token: {}"]);
    }

    #[test]
    fn an_item_saved_with_one_header_still_reads() {
        // A vault written before an item could name more than one header.
        let old: Token = serde_json::from_value(json!({
            "id": 7, "name": "github", "hosts": ["api.github.com"], "header": "Authorization: Bearer {}",
            "token": GH, "created": 1, "modified": 1
        }))
        .unwrap();
        assert_eq!(old.all_headers(), vec!["Authorization: Bearer {}"]);
        assert_eq!(old.summary().headers, vec!["Authorization: Bearer {}"]);
        // And an item with one header is written as before: no `headers`.
        let mut written = serde_json::to_value(&old).unwrap();
        assert!(written.get("headers").is_none());
        let mut two = old.clone();
        two.set_headers(vec![
            "x-api-key: {}".into(),
            "Authorization: Bearer {}".into(),
        ]);
        written = serde_json::to_value(&two).unwrap();
        assert_eq!(written["header"], "x-api-key: {}");
    }

    #[test]
    fn use_is_noted_at_most_once_a_minute() {
        let mut v = vault();
        github(&mut v);
        let use_at = |v: &mut Vault, now| {
            let request: Request = serde_json::from_value(
                json!({ "op": "token", "name": "github", "host": "api.github.com" }),
            )
            .unwrap();
            handle(v, request, now).unwrap().1
        };
        assert!(use_at(&mut v, 100));
        assert!(!use_at(&mut v, 130));
        assert!(use_at(&mut v, 160));
    }
}
