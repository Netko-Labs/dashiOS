//! Unlocking at login: PAM's password opens the vault, or makes it the first time.

use serde_json::json;

use super::{Daemon, now, reply::Reply};
use crate::{import, vault::Vault};

impl Daemon {
    pub(super) fn unlock_at_login(
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
}
