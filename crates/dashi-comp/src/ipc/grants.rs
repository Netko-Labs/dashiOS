//! The IPC methods the shell grants to processes other than itself
//! (`ipc-clients`, docs/compositor-ipc.md "Who may ask"). Only methods the
//! table marks `Granted` can be; whom to grant is the shell's decision.

use serde::{Deserialize, Serialize};

use super::{
    protocol::Pid,
    table::{self, Who},
};
use crate::session::trust::descends_from;

/// The most processes one request may name.
pub(crate) const MAX_CLIENTS: usize = 64;

#[derive(Debug, PartialEq, Eq)]
struct Grant {
    pid: i32,
    methods: Vec<&'static str>,
}

#[derive(Default, Debug, PartialEq, Eq)]
pub(crate) struct Grants {
    list: Vec<Grant>,
}

/// `ipc-clients`'s params: the processes granted `granted` methods.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IpcClients {
    pub clients: Vec<IpcClient>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IpcClient {
    pub pid: Pid,
    pub methods: Vec<String>,
}

impl Grants {
    /// The whole list each time; all or nothing.
    pub(crate) fn parse(params: &IpcClients) -> Result<Self, String> {
        if params.clients.len() > MAX_CLIENTS {
            return Err(format!("`clients` names more than {MAX_CLIENTS} processes"));
        }
        let list = params
            .clients
            .iter()
            .map(|client| {
                let methods = client
                    .methods
                    .iter()
                    .map(|name| match table::find(name) {
                        Some(method) if method.who == Who::Granted => Ok(method.name),
                        Some(_) => Err(format!("{name} can't be granted")),
                        None => Err(format!("unknown method: {name}")),
                    })
                    .collect::<Result<_, String>>()?;
                Ok(Grant {
                    pid: client.pid.to::<i32>(),
                    methods,
                })
            })
            .collect::<Result<_, String>>()?;
        Ok(Self { list })
    }

    /// Whether the process `pid` (or one it runs under) was granted `method`.
    pub(crate) fn allows(&self, pid: i32, method: &str) -> bool {
        self.list
            .iter()
            .filter(|grant| grant.methods.contains(&method))
            .any(|grant| descends_from(pid, grant.pid))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn parse(value: serde_json::Value) -> Result<Grants, String> {
        Grants::parse(&crate::ipc::protocol::read(value)?)
    }

    #[test]
    fn only_grantable_methods_are_granted() {
        let me = std::process::id() as i32;
        let grants =
            parse(json!({ "clients": [{ "pid": me, "methods": ["windows", "focus"] }] })).unwrap();
        assert!(grants.allows(me, "windows"));
        assert!(!grants.allows(me, "close"));
        assert!(!grants.allows(i32::MAX, "windows"));
        assert!(
            parse(json!({ "clients": [{ "pid": me, "methods": ["capture"] }] }))
                .unwrap_err()
                .contains("can't be granted")
        );
        assert!(
            parse(json!({ "clients": [{ "pid": me, "methods": ["nope"] }] }))
                .unwrap_err()
                .contains("unknown method")
        );
        assert!(parse(json!({ "clients": [{ "pid": 1, "methods": [] }] })).is_err());
        assert!(parse(json!({ "clients": "all" })).is_err());
        assert_eq!(parse(json!({ "clients": [] })), Ok(Grants::default()));
    }
}
