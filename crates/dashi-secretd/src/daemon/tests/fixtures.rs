//! Shared setup: a daemon in a temp dir, the people who call it, and request helpers.

use super::*;

pub(super) const ME: u32 = 1000;
pub(super) const PASSWORD: &str = "Y29ycmVjdCBob3JzZQ=="; // "correct horse"

pub(super) fn caller(uid: u32, cgroup: &str) -> Caller {
    Caller {
        uid,
        pid: 4242,
        cgroup: cgroup.into(),
    }
}

pub(super) fn me() -> Caller {
    caller(ME, "/user.slice/user-1000.slice/session-2.scope")
}

pub(super) fn agent() -> Caller {
    caller(
        ME,
        "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-claude-1.scope",
    )
}

pub(super) fn root() -> Caller {
    caller(0, "/system.slice/greetd.service")
}

pub(super) fn daemon() -> (Daemon, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Daemon::with_kdf(Store::new(dir.path()), Box::new(NoTpm), KdfParams::cheap);
    (daemon, dir)
}

pub(super) fn ask(daemon: &mut Daemon, who: &Caller, request: Value) -> Result<Value, String> {
    let request: Request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    let line = Reply::line(daemon.handle(who, request));
    let value: Value = serde_json::from_str(&line).unwrap();
    if value["ok"] == true {
        Ok(value)
    } else {
        Err(value["error"].as_str().unwrap_or("").to_string())
    }
}

pub(super) fn logged_in() -> (Daemon, tempfile::TempDir) {
    let (mut d, dir) = daemon();
    let created = ask(
        &mut d,
        &root(),
        json!({ "op": "unlock", "user": ME, "password": PASSWORD }),
    )
    .unwrap();
    assert_eq!(created["created"], true);
    (d, dir)
}

pub(super) fn save_login(d: &mut Daemon, site: &str, account: &str, agents: &str) -> u64 {
    let r = ask(
        d,
        &me(),
        json!({ "op": "save-login", "site": site, "account": account, "password": "aHVudGVyMg==", "totp": "R0VaREdOQlZHWTNUUU9KUQ==", "agents": agents }),
    )
    .unwrap();
    r["id"].as_u64().unwrap()
}
