//! Changing a saved token: its hosts, headers or the token itself.

use super::{headers::headers_of, hosts::hosts_of, secret::check_token};
use crate::{
    daemon::reply::Reply,
    vault::{Vault, bytes::Secret, token::Token},
};

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
