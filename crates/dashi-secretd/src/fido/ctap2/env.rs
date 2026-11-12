//! What a command needs from the world: the vault, the person, the time.

use crate::vault::Data;

/// What the person is asked before a passkey is made or used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ask {
    Register { rp_id: String, user: String },
    SignIn { rp_id: String, user: String },
}

/// Runs a closure on the unlocked vault (and saves it); false when there is none.
pub type WithVault<'a> = &'a dyn Fn(&mut dyn FnMut(&mut Data)) -> bool;

/// What a command needs: the vault (locked while `with` runs), the person's
/// answer (asked with no lock held), and the time.
pub struct Env<'a> {
    /// Runs `f` on the unlocked vault and saves it; false when there is none.
    pub with: WithVault<'a>,
    pub approve: &'a dyn Fn(&Ask) -> bool,
    pub now: u64,
}
