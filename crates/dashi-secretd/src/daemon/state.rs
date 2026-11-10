//! The daemon's state: the store, the open vaults, and the small ways in and out of them.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::{
    fido::approval::Approvals,
    vault::{Sealer, Vault, crypto::KdfParams, store::Store},
};

pub struct Daemon {
    pub(super) store: Store,
    pub(super) sealer: Box<dyn Sealer>,
    pub(super) open: HashMap<u32, Vault>,
    pub(super) failures: HashMap<u32, (u32, Instant)>,
    pub(super) kdf: fn() -> KdfParams,
    /// A development daemon, run as you, takes the login's ops from you too
    /// (`--dev-pam-uid`, refused for the system daemon; see the binary).
    pub(super) dev_pam: Option<u32>,
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

    /// Write `uid`'s open vault to the store.
    pub(super) fn save(&self, uid: u32) -> Result<(), String> {
        let vault = self.open.get(&uid).ok_or("the vault is locked")?;
        self.store.write(uid, &vault.to_bytes()?)
    }
}
