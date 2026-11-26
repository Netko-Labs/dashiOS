//! Which clients get glass (`glass-clients`): the shell decides. The shell's
//! own processes (its Metal hosts) always; other apps unless the shell turned
//! glass off for them all (`others: false`) or for their program (`deny`).
//! What a client is, is read once, when it binds a glass global.

use std::{collections::HashMap, path::PathBuf, sync::atomic::AtomicI32};

use serde::{Deserialize, Serialize};
use smithay::reexports::wayland_server::{Client, DisplayHandle, backend::ClientId};

use crate::session::trust;

/// `glass-clients {others, deny}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GlassClients {
    /// Whether apps that aren't the shell's get glass.
    pub others: bool,
    /// Programs (absolute paths) that never get it.
    pub deny: Vec<String>,
}

/// What a client is, for the grant.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Known {
    pub shell: bool,
    pub exe: Option<PathBuf>,
}

/// The grant, and the clients known.
#[derive(Debug)]
pub(crate) struct Clients {
    others: bool,
    deny: Vec<PathBuf>,
    known: HashMap<ClientId, Known>,
}

impl Default for Clients {
    /// Until the shell says: everyone (decisions.md D731).
    fn default() -> Self {
        Self {
            others: true,
            deny: Vec::new(),
            known: HashMap::new(),
        }
    }
}

impl Clients {
    /// IPC `glass-clients`.
    pub(crate) fn set(&mut self, params: &GlassClients) -> Result<(), String> {
        let deny: Vec<PathBuf> = params
            .deny
            .iter()
            .map(PathBuf::from)
            .map(|path| path.is_absolute().then_some(path))
            .collect::<Option<_>>()
            .ok_or("glass-clients: `deny` must be absolute paths")?;
        self.others = params.others;
        self.deny = deny;
        Ok(())
    }

    /// Learn `client` (when it binds a glass global), forgetting clients that are gone.
    pub(crate) fn learn(&mut self, dh: &DisplayHandle, client: &Client, shell: &AtomicI32) {
        self.known
            .retain(|id, _| dh.backend_handle().get_client_data(id.clone()).is_ok());
        if self.known.contains_key(&client.id()) {
            return;
        }
        let known = Known {
            shell: trust::is_shell_client(client, shell),
            exe: exe_of(client),
        };
        self.known.insert(client.id(), known);
    }

    /// Whether the client `id` gets glass.
    pub(crate) fn granted(&self, id: &ClientId) -> bool {
        self.known.get(id).is_some_and(|known| self.grants(known))
    }

    fn grants(&self, known: &Known) -> bool {
        known.shell
            || (self.others
                && known
                    .exe
                    .as_ref()
                    .is_none_or(|exe| !self.deny.iter().any(|denied| denied == exe)))
    }
}

/// The program of the process that connected (none for a sandboxed one: never the shell's).
fn exe_of(client: &Client) -> Option<PathBuf> {
    let data = client.get_data::<crate::state::ClientState>()?;
    let process = data.process.as_ref()?;
    let mut exe = None;
    // The program of the process that connected, while it still lives (session/process.rs).
    let alive = process.is(|pid| {
        exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok();
        exe.is_some()
    });
    exe.filter(|_| alive)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(shell: bool, exe: &str) -> Known {
        Known {
            shell,
            exe: Some(PathBuf::from(exe)),
        }
    }

    #[test]
    fn the_shell_always_and_others_unless_turned_off() {
        let mut clients = Clients::default();
        assert!(clients.grants(&known(false, "/usr/bin/foot")));
        let deny = |others: bool, deny: &[&str]| GlassClients {
            others,
            deny: deny.iter().map(|path| (*path).to_owned()).collect(),
        };
        clients.set(&deny(true, &["/usr/bin/foot"])).unwrap();
        assert!(!clients.grants(&known(false, "/usr/bin/foot")));
        assert!(clients.grants(&known(false, "/usr/bin/kitty")));
        clients.set(&deny(false, &[])).unwrap();
        assert!(!clients.grants(&known(false, "/usr/bin/kitty")));
        assert!(clients.grants(&known(true, "/usr/libexec/dashi/mirin-metal-host")));
        // An unknown client (never bound a glass global) gets none.
        assert!(clients.set(&deny(true, &["foot"])).is_err());
    }
}
