//! Handing a token out, for a request to one of its hosts only.

use serde_json::json;

use super::{hosts::host_listed, name::normalize_name};
use crate::{daemon::reply::Reply, vault::Vault};

/// A token's last use is written at most this often (the proxy asks per request).
const USE_GRAIN: u64 = 60;

/// `token`: the secret for `name`, only when `host` is one it is listed for.
pub(super) fn issue(
    vault: &mut Vault,
    name: &str,
    host: &str,
    now: u64,
) -> Result<(Reply, bool), String> {
    let name = normalize_name(name)?;
    let item = vault
        .data
        .tokens
        .iter_mut()
        .find(|t| t.name == name)
        .ok_or("no such token")?;
    if !host_listed(&item.hosts, host) {
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
