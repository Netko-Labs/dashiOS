//! The IPC methods the shell grants to processes other than itself
//! (`ipc-clients`, docs/compositor-ipc.md "Who may ask"). Only methods the
//! table marks `Granted` can be; whom to grant is the shell's decision.

use serde_json::Value;

use super::{
    params::Params,
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

impl Grants {
    /// `{clients: [{pid, methods: string[]}]}`, the whole list each time; all or nothing.
    pub(crate) fn parse(params: &Params) -> Result<Self, String> {
        let clients = params
            .get("clients")
            .and_then(Value::as_array)
            .ok_or("`clients` must be a list")?;
        if clients.len() > MAX_CLIENTS {
            return Err(format!("`clients` names more than {MAX_CLIENTS} processes"));
        }
        let list = clients
            .iter()
            .map(|entry| {
                let pid = entry
                    .get("pid")
                    .and_then(Value::as_i64)
                    .and_then(|pid| i32::try_from(pid).ok())
                    .filter(|pid| *pid > 1)
                    .ok_or("each client needs a `pid`, a process id above 1")?;
                let methods = entry
                    .get("methods")
                    .and_then(Value::as_array)
                    .ok_or("each client needs `methods`, a list of method names")?
                    .iter()
                    .map(|name| {
                        let name = name.as_str().ok_or("`methods` must be method names")?;
                        match table::find(name) {
                            Some(method) if method.who == Who::Granted => Ok(method.name),
                            Some(_) => Err(format!("{name} can't be granted")),
                            None => Err(format!("unknown method: {name}")),
                        }
                    })
                    .collect::<Result<_, String>>()?;
                Ok(Grant { pid, methods })
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

    fn parse(value: Value) -> Result<Grants, String> {
        match value {
            Value::Object(params) => Grants::parse(&params),
            _ => unreachable!("tests pass objects"),
        }
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
