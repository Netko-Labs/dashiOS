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
