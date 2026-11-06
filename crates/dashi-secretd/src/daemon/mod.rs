//! The daemon's state and who may do what. Every request is checked here
//! before it touches a vault:
//!
//! - anything from an agent's cgroup (`dashi-agent-*`) is refused, whatever it asks;
//! - `unlock` and `lock` (the login password, the session's end) come from root (PAM) only;
//! - everything else reaches the caller's own vault, by its uid, and nobody else's;
//! - a vault is made only at login (PAM), never by a process that merely runs as you;
//! - wrong passwords are slowed down.

pub mod logins;
pub mod payments;
pub mod protocol;
pub mod reply;
pub mod secret_service;
pub mod tokens;

use std::{
    collections::HashMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use std::sync::Arc;

use crate::{
    caller::Caller,
    fido::approval::Approvals,
    import,
    vault::{Sealer, Vault, crypto::KdfParams, store::Store},
};
use protocol::Request;
use reply::Reply;

/// After this many wrong passwords in a row, each try waits LOCKOUT.
const FREE_TRIES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(30);

pub struct Daemon {
    store: Store,
    sealer: Box<dyn Sealer>,
    open: HashMap<u32, Vault>,
    failures: HashMap<u32, (u32, Instant)>,
    kdf: fn() -> KdfParams,
    /// A development daemon, run as you, takes the login's ops from you too
    /// (`--dev-pam-uid`, refused for the system daemon; see the binary).
    dev_pam: Option<u32>,
    /// Questions to the person (passkeys, payments), answered through `approve`.
    pub approvals: Arc<Approvals>,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Daemon {
    pub fn new(store: Store, sealer: Box<dyn Sealer>) -> Self {
        Self::with_kdf(store, sealer, KdfParams::recommended)
    }

    pub fn with_kdf(store: Store, sealer: Box<dyn Sealer>, kdf: fn() -> KdfParams) -> Self {
        Self {
            store,
            sealer,
            open: HashMap::new(),
            failures: HashMap::new(),
            kdf,
            dev_pam: None,
            approvals: Arc::new(Approvals::default()),
        }
    }

    /// Before a payment is asked about: who may (the person, never an agent), and whether it is within the limits.
    pub fn pay_check(&self, caller: &Caller, card: u64, cents: u64) -> Result<(), String> {
        if caller.is_agent() || caller.uid == 0 {
            return Err("only the person's shell may pay".into());
        }
        let vault = self.open.get(&caller.uid).ok_or("the vault is locked")?;
        payments::check(vault, card, cents, now())
    }

    /// After the person said yes: the payment noted, and the card for the broker.
    pub fn pay_finish(
        &mut self,
        caller: &Caller,
        merchant: &str,
        card: u64,
        cents: u64,
    ) -> Result<Reply, String> {
        let vault = self
            .open
            .get_mut(&caller.uid)
            .ok_or("the vault is locked")?;
        let reply = payments::finish(vault, merchant, card, cents, now())?;
        self.save(caller.uid)?;
        Ok(reply)
    }

    /// Run `f` on `uid`'s unlocked vault and save it; false when it is locked (or can't be saved).
    pub fn with_data(&mut self, uid: u32, f: &mut dyn FnMut(&mut crate::vault::Data)) -> bool {
        let Some(vault) = self.open.get_mut(&uid) else {
            return false;
        };
        f(&mut vault.data);
        self.save(uid).is_ok()
    }

    /// For a development daemon only: `uid` may send the login's ops.
    pub fn dev_pam(mut self, uid: u32) -> Self {
        self.dev_pam = Some(uid);
        self
    }

    pub fn is_unlocked(&self, uid: u32) -> bool {
        self.open.contains_key(&uid)
    }

    /// Answer one request from `caller`.
    pub fn handle(&mut self, caller: &Caller, request: Request) -> Result<Reply, String> {
        if caller.is_agent() {
            return Err("agents may not use the vault; ask the person through Dashi".into());
        }
        let from_pam = caller.uid == 0 || self.dev_pam == Some(caller.uid);
        if request.is_pam() && !from_pam {
            return Err("only the login (PAM) may do that".into());
        }
        if !request.is_pam() && caller.uid == 0 {
            return Err("root has no vault".into());
        }
        let uid = caller.uid;
        match request {
            Request::Unlock {
                user,
                password,
                keyring,
            } => self.unlock_at_login(
                user,
                password.expose(),
                keyring.as_ref().map(|k| k.0.as_slice()),
            ),
            Request::Lock { user } => {
                self.open.remove(&user);
                Ok(Reply::ok())
            }
            Request::Status {} => Ok(Reply::Plain(json!({
                "exists": self.store.exists(uid),
                "unlocked": self.is_unlocked(uid),
                "tpm": self.open.get(&uid).map(Vault::has_tpm),
            }))),
            Request::UnlockSelf { password } => {
                if self.is_unlocked(uid) {
                    return Ok(Reply::ok());
                }
                if !self.store.exists(uid) {
                    return Err("there is no vault yet; it is made when you log in".into());
                }
                self.throttle(uid)?;
                let opened = self.store.read(uid).and_then(|file| {
                    Vault::open(uid, &file, password.expose(), self.sealer.as_ref())
                });
                let vault = self.count(uid, opened)?;
                self.open.insert(uid, vault);
                Ok(Reply::ok())
            }
            Request::LockSelf {} => {
                self.open.remove(&uid);
                Ok(Reply::ok())
            }
            Request::Verify { password } => {
                self.throttle(uid)?;
                let vault = self.open.get(&uid).ok_or("the vault is locked")?;
                let right = vault.verify(password.expose(), self.sealer.as_ref());
                self.count(
                    uid,
                    if right {
                        Ok(())
                    } else {
                        Err("wrong password".into())
                    },
                )
                .map(|()| Reply::Plain(json!({ "verified": true })))
            }
            Request::ChangePassword { old, new } => {
                self.throttle(uid)?;
                let vault = self.open.get_mut(&uid).ok_or("the vault is locked")?;
                let changed =
                    vault.change_password(old.expose(), new.expose(), self.sealer.as_ref());
                self.count(uid, changed)?;
                self.save(uid)?;
                Ok(Reply::ok())
            }
            // The server keeps the connection for events; nothing to answer here.
            Request::WatchApprovals {} => Ok(Reply::ok()),
            Request::Approve { id, password } => {
                if !self.approvals.is_open(uid, id) {
                    return Err("that question isn't open".into());
                }
                self.throttle(uid)?;
                let vault = self.open.get(&uid).ok_or("the vault is locked")?;
                let right = vault.verify(password.expose(), self.sealer.as_ref());
                self.count(
                    uid,
                    if right {
                        Ok(())
                    } else {
                        Err("wrong password".to_string())
                    },
                )?;
                self.approvals.answer(uid, id, true);
                Ok(Reply::ok())
            }
            Request::Deny { id } => {
                self.approvals.answer(uid, id, false);
                Ok(Reply::ok())
            }
            Request::SetLimits {
                per_payment,
                per_month,
                password,
            } => {
                self.throttle(uid)?;
                let vault = self.open.get(&uid).ok_or("the vault is locked")?;
                let right = vault.verify(password.expose(), self.sealer.as_ref());
                self.count(
                    uid,
                    if right {
                        Ok(())
                    } else {
                        Err("wrong password".to_string())
                    },
                )?;
                if per_payment > payments::CEILING || per_month < per_payment {
                    return Err(
                        "the limit for a month can't be under the limit for one payment".into(),
                    );
                }
                let vault = self.open.get_mut(&uid).ok_or("the vault is locked")?;
                vault.data.spending.per_payment = per_payment;
                vault.data.spending.per_month = per_month;
                self.save(uid)?;
                Ok(Reply::ok())
            }
            // Asked of the person without the daemon held: the server does it (pay_check, pay_finish).
            Request::Pay { .. } => Err("pay goes through the server".into()),
            request => {
                let vault = self.open.get_mut(&uid).ok_or("the vault is locked")?;
                let (reply, changed) = if payments::owns(&request) {
                    payments::handle(vault, request, now())?
                } else if secret_service::owns(&request) {
                    secret_service::handle(vault, request, now())?
                } else if tokens::owns(&request) {
                    tokens::handle(vault, request, now())?
                } else {
                    logins::handle(vault, request, now())?
                };
                if changed {
                    self.save(uid)?;
                }
                Ok(reply)
            }
        }
    }

    fn unlock_at_login(
        &mut self,
        uid: u32,
        password: &[u8],
        keyring: Option<&[u8]>,
    ) -> Result<Reply, String> {
        if uid == 0 {
            return Err("root has no vault".into());
        }
        let created = !self.store.exists(uid);
        let mut vault = if created {
            Vault::create(uid, password, (self.kdf)(), self.sealer.as_ref(), now())?
        } else {
            let file = self.store.read(uid)?;
            // PAM checked the password already; a vault that doesn't open with
            // it was made with an older one (changed outside Dashi).
            Vault::open(uid, &file, password, self.sealer.as_ref()).map_err(
                |_| "the vault doesn't open with this password (was it changed elsewhere?)",
            )?
        };
        let imported = match keyring {
            Some(file)
                if !vault
                    .data
                    .imported
                    .iter()
                    .any(|i| i == import::LOGIN_KEYRING) =>
            {
                let count = import::import_login_keyring(&mut vault.data, file, password, now())
                    .unwrap_or_else(|error| {
                        eprintln!(
                            "dashi-secretd: uid {uid}: the login keyring was not imported: {error}"
                        );
                        0
                    });
                vault.data.imported.push(import::LOGIN_KEYRING.into());
                count
            }
            _ => 0,
        };
        let changed = created || imported > 0 || keyring.is_some();
        self.open.insert(uid, vault);
        if changed {
            self.save(uid)?;
        }
        self.failures.remove(&uid);
        Ok(Reply::Plain(
            json!({ "created": created, "imported": imported }),
        ))
    }

    fn save(&self, uid: u32) -> Result<(), String> {
        let vault = self.open.get(&uid).ok_or("the vault is locked")?;
        self.store.write(uid, &vault.to_bytes()?)
    }

    /// Too many wrong passwords lately: wait.
    fn throttle(&self, uid: u32) -> Result<(), String> {
        match self.failures.get(&uid) {
            Some((count, last)) if *count >= FREE_TRIES && last.elapsed() < LOCKOUT => {
                Err("too many wrong passwords; try again in a moment".into())
            }
            _ => Ok(()),
        }
    }

    fn count<T>(&mut self, uid: u32, result: Result<T, String>) -> Result<T, String> {
        match &result {
            Ok(_) => {
                self.failures.remove(&uid);
            }
            Err(_) => {
                let entry = self.failures.entry(uid).or_insert((0, Instant::now()));
                entry.0 += 1;
                entry.1 = Instant::now();
            }
        }
        result
    }
}

#[cfg(test)]
mod tests;
