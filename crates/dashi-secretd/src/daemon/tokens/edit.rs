//! Saving a new token with the hosts and headers it is for, and changing a
//! saved one: its hosts, headers or the token itself.

use serde_json::json;

use super::{
    fields::{check_token, normalize_name},
    headers::headers_of,
    hosts::hosts_of,
};
use crate::{
    daemon::reply::Reply,
    vault::{
        Vault,
        bytes::Secret,
        token::{DEFAULT_HEADER, Token},
    },
};

const MAX_TOKENS: usize = 1_000;

/// `save-token`: check every part, refuse a name already used, and keep the token.
pub(super) fn save(
    vault: &mut Vault,
    name: String,
    hosts: Vec<String>,
    (header, headers): (Option<String>, Option<Vec<String>>),
    token: Secret,
    now: u64,
) -> Result<(Reply, bool), String> {
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

fn item(vault: &mut Vault, id: u64) -> Result<&mut Token, String> {
    vault
        .data
        .tokens
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "no such token".into())
}

/// `update-token`: change only what was sent; an empty token keeps the one there.
pub(super) fn update(
    vault: &mut Vault,
    id: u64,
    hosts: Option<Vec<String>>,
    (header, headers): (Option<String>, Option<Vec<String>>),
    token: Option<Secret>,
    now: u64,
) -> Result<(Reply, bool), String> {
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
