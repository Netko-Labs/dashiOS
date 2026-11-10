//! API tokens (docs/secrets.md, "Tokens that stay home"): kept with the hosts
//! they are for and the header they go in, listed without the token, and
//! handed out only for a request to one of those hosts. The shell's token
//! proxy asks (`token {name, host}`); agents never reach this at all.

mod edit;
mod fields;
mod headers;
mod hosts;
mod issue;

pub use fields::normalize_name;
pub use headers::{headers_of, normalize_header};
pub use hosts::{host_listed, normalize_host};

use serde_json::json;

use super::{protocol::Request, reply::Reply};
use crate::vault::{Vault, token::Token};

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

/// Answer one token request on `vault`: the reply, and whether the vault changed.
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
        } => edit::save(vault, name, hosts, (header, headers), token, now),
        Request::UpdateToken {
            id,
            hosts,
            header,
            headers,
            token,
        } => edit::update(vault, id, hosts, (header, headers), token, now),
        Request::DeleteToken { id } => {
            let before = vault.data.tokens.len();
            vault.data.tokens.retain(|t| t.id != id);
            Ok((Reply::ok(), before != vault.data.tokens.len()))
        }
        Request::Token { name, host } => issue::issue(vault, &name, &host, now),
        _ => Err("unknown request".into()),
    }
}

#[cfg(test)]
mod tests;
