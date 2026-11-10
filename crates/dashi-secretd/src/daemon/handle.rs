//! Answering one request: who may ask it, then the step that does it.

use serde_json::json;

use super::{
    Daemon, logins, now, payments, protocol::Request, reply::Reply, secret_service, tokens,
};
use crate::{caller::Caller, vault::Vault};

impl Daemon {
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
            Request::UnlockSelf { password } => self.unlock_self(uid, password.expose()),
            Request::LockSelf {} => {
                self.open.remove(&uid);
                Ok(Reply::ok())
            }
            Request::Verify { password } => self
                .check_password(uid, password.expose())
                .map(|()| Reply::Plain(json!({ "verified": true }))),
            Request::ChangePassword { old, new } => {
                self.change_password(uid, old.expose(), new.expose())
            }
            // The server keeps the connection for events; nothing to answer here.
            Request::WatchApprovals {} => Ok(Reply::ok()),
            Request::Approve { id, password } => self.approve(uid, id, password.expose()),
            Request::Deny { id } => {
                self.approvals.answer(uid, id, false);
                Ok(Reply::ok())
            }
            Request::SetLimits {
                per_payment,
                per_month,
                password,
            } => self.set_limits(uid, per_payment, per_month, password.expose()),
            // Asked of the person without the daemon held: the server does it (pay_check, pay_finish).
            Request::Pay { .. } => Err("pay goes through the server".into()),
            request => self.in_vault(uid, request),
        }
    }

    /// Open `uid`'s own vault with the password it was made with.
    fn unlock_self(&mut self, uid: u32, password: &[u8]) -> Result<Reply, String> {
        if self.is_unlocked(uid) {
            return Ok(Reply::ok());
        }
        if !self.store.exists(uid) {
            return Err("there is no vault yet; it is made when you log in".into());
        }
        self.throttle(uid)?;
        let opened = self
            .store
            .read(uid)
            .and_then(|file| Vault::open(uid, &file, password, self.sealer.as_ref()));
        let vault = self.count(uid, opened)?;
        self.open.insert(uid, vault);
        Ok(Reply::ok())
    }

    /// Whether `password` is the open vault's, counted against the slowdown.
    fn check_password(&mut self, uid: u32, password: &[u8]) -> Result<(), String> {
        self.throttle(uid)?;
        let vault = self.open.get(&uid).ok_or("the vault is locked")?;
        let right = vault.verify(password, self.sealer.as_ref());
        self.count(
            uid,
            if right {
                Ok(())
            } else {
                Err("wrong password".into())
            },
        )
    }

    fn change_password(&mut self, uid: u32, old: &[u8], new: &[u8]) -> Result<Reply, String> {
        self.throttle(uid)?;
        let vault = self.open.get_mut(&uid).ok_or("the vault is locked")?;
        let changed = vault.change_password(old, new, self.sealer.as_ref());
        self.count(uid, changed)?;
        self.save(uid)?;
        Ok(Reply::ok())
    }

    /// Say yes to an open question, once the password proves the person is there.
    fn approve(&mut self, uid: u32, id: u64, password: &[u8]) -> Result<Reply, String> {
        if !self.approvals.is_open(uid, id) {
            return Err("that question isn't open".into());
        }
        self.check_password(uid, password)?;
        self.approvals.answer(uid, id, true);
        Ok(Reply::ok())
    }

    /// New spending limits, only with the password.
    fn set_limits(
        &mut self,
        uid: u32,
        per_payment: u64,
        per_month: u64,
        password: &[u8],
    ) -> Result<Reply, String> {
        self.check_password(uid, password)?;
        if per_payment > payments::CEILING || per_month < per_payment {
            return Err("the limit for a month can't be under the limit for one payment".into());
        }
        let vault = self.open.get_mut(&uid).ok_or("the vault is locked")?;
        vault.data.spending.per_payment = per_payment;
        vault.data.spending.per_month = per_month;
        self.save(uid)?;
        Ok(Reply::ok())
    }

    /// Everything else is for the open vault: the handler that owns the request, then a save if it changed.
    fn in_vault(&mut self, uid: u32, request: Request) -> Result<Reply, String> {
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
