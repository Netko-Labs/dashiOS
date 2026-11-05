//! Logins: listed without their secrets; a password revealed only for the
//! broker to type, a one-time code computed here. Using either marks the
//! login used (the consent sheet lists the most recent first).

use serde_json::json;

use super::{protocol::Request, reply::Reply};
use crate::{
    totp,
    vault::{
        Vault,
        bytes::Secret,
        item::{AgentUse, Login, Totp, normalize_site, site_matches},
    },
};

const MAX_LOGINS: usize = 20_000;
const MAX_FIELD: usize = 4096;

fn parse_totp(secret: &Secret) -> Result<Totp, String> {
    let text = std::str::from_utf8(secret.expose())
        .map_err(|_| "that one-time code secret is not text")?;
    totp::parse(text).ok_or_else(|| {
        "that is not a one-time code secret (base32, or an otpauth:// address)".into()
    })
}

fn checked(field: &str, what: &str) -> Result<(), String> {
    if field.is_empty() || field.len() > MAX_FIELD || field.chars().any(char::is_control) {
        return Err(format!(
            "{what} is empty, too long, or holds control characters"
        ));
    }
    Ok(())
}

fn login(vault: &mut Vault, id: u64) -> Result<&mut Login, String> {
    vault
        .data
        .logins
        .iter_mut()
        .find(|l| l.id == id)
        .ok_or_else(|| "no such login".into())
}

fn usable_by(login: &Login, for_agent: bool) -> Result<(), String> {
    if for_agent && login.agents == AgentUse::Never {
        return Err("agents may never use this login".into());
    }
    Ok(())
}

pub fn handle(vault: &mut Vault, request: Request, now: u64) -> Result<(Reply, bool), String> {
    match request {
        Request::Logins { site } => {
            let mut logins: Vec<_> = vault
                .data
                .logins
                .iter()
                .filter(|l| {
                    site.as_deref()
                        .is_none_or(|host| site_matches(&l.site, host))
                })
                .map(Login::summary)
                .collect();
            // Most recently used first, then by site and account.
            logins.sort_by(|a, b| {
                b.last_used
                    .cmp(&a.last_used)
                    .then_with(|| a.site.cmp(&b.site))
                    .then_with(|| a.account.cmp(&b.account))
            });
            Ok((Reply::Plain(json!({ "logins": logins })), false))
        }
        Request::SaveLogin {
            site,
            account,
            password,
            totp,
            agents,
        } => {
            let site = normalize_site(&site).ok_or("that is not a site's address")?;
            checked(&account, "The account name")?;
            if password.expose().is_empty() || password.expose().len() > MAX_FIELD {
                return Err("the password is empty or too long".into());
            }
            let totp = totp.as_ref().map(parse_totp).transpose()?;
            if vault.data.logins.len() >= MAX_LOGINS {
                return Err("the vault is full".into());
            }
            if let Some(existing) = vault
                .data
                .logins
                .iter_mut()
                .find(|l| l.site == site && l.account == account)
            {
                existing.password = password;
                if totp.is_some() {
                    existing.totp = totp;
                }
                existing.agents = agents;
                existing.modified = now;
                return Ok((Reply::Plain(json!({ "id": existing.id })), true));
            }
            let id = vault.data.next_id();
            vault.data.logins.push(Login {
                id,
                site,
                account,
                password,
                totp,
                agents,
                created: now,
                modified: now,
                last_used: None,
            });
            Ok((Reply::Plain(json!({ "id": id })), true))
        }
        Request::UpdateLogin {
            id,
            account,
            password,
            totp,
            agents,
        } => {
            if let Some(account) = &account {
                checked(account, "The account name")?;
            }
            let totp = totp
                .as_ref()
                .map(|t| {
                    if t.expose().is_empty() {
                        Ok(None)
                    } else {
                        parse_totp(t).map(Some)
                    }
                })
                .transpose()?;
            let login = login(vault, id)?;
            if let Some(account) = account {
                login.account = account;
            }
            if let Some(password) = password.filter(|p| !p.expose().is_empty()) {
                login.password = password;
            }
            if let Some(totp) = totp {
                login.totp = totp;
            }
            if let Some(agents) = agents {
                login.agents = agents;
            }
            login.modified = now;
            Ok((Reply::ok(), true))
        }
        Request::DeleteLogin { id } => {
            let before = vault.data.logins.len();
            vault.data.logins.retain(|l| l.id != id);
            Ok((Reply::ok(), before != vault.data.logins.len()))
        }
        Request::RevealPassword { id, for_agent } => {
            let login = login(vault, id)?;
            usable_by(login, for_agent)?;
            login.last_used = Some(now);
            Ok((
                Reply::Secret {
                    fields: json!({ "site": login.site, "account": login.account }),
                    key: "password",
                    secret: login.password.clone(),
                },
                true,
            ))
        }
        Request::Code { id, for_agent } => {
            let login = login(vault, id)?;
            usable_by(login, for_agent)?;
            let totp = login
                .totp
                .as_ref()
                .ok_or("this login has no one-time code")?;
            let code = Secret::new(totp::code(totp, now).into_bytes());
            let remaining = totp::remaining(totp, now);
            login.last_used = Some(now);
            Ok((
                Reply::Secret {
                    fields: json!({ "site": login.site, "remaining": remaining }),
                    key: "code",
                    secret: code,
                },
                true,
            ))
        }
        _ => Err("unknown request".into()),
    }
}
