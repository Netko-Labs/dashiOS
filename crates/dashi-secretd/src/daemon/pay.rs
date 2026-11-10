//! The two halves of a payment the server holds the daemon between.

use super::{Daemon, now, payments, reply::Reply};
use crate::caller::Caller;

impl Daemon {
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
}
