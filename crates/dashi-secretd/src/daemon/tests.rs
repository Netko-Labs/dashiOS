//! Who may do what, and that no reply carries a secret it shouldn't.

use serde_json::{Value, json};

use super::*;
use crate::vault::{NoTpm, crypto::KdfParams};

/// Stripe's test card number, which no bank takes.
const TEST_CARD: &str = "NDI0MjQyNDI0MjQyNDI0Mg=="; // 4242424242424242
const CVC: &str = "MTIz"; // 123

fn card(d: &mut Daemon, single_use: bool) -> u64 {
    let r = ask(
        d,
        &me(),
        json!({ "op": "save-card", "label": "Test", "number": TEST_CARD, "expiry": "12/34", "cvc": CVC, "singleUse": single_use }),
    )
    .unwrap();
    r["id"].as_u64().unwrap()
}

#[test]
fn payments_stay_within_the_limits_and_a_single_use_card_is_used_once() {
    let (mut d, _dir) = logged_in();
    // Not a card: refused.
    assert!(ask(&mut d, &me(), json!({ "op": "save-card", "label": "x", "number": "MTIzNA==", "expiry": "12/34", "cvc": CVC })).is_err());
    let once = card(&mut d, true);
    let listed = ask(&mut d, &me(), json!({ "op": "cards" })).unwrap();
    assert_eq!(listed["cards"][0]["last4"], "4242");
    assert!(
        !listed.to_string().contains("4242424242424242") && !listed.to_string().contains(TEST_CARD)
    );
    // $100 a payment, $300 a month, by default.
    assert!(
        d.pay_check(&me(), once, 10_001)
            .unwrap_err()
            .contains("per payment")
    );
    assert!(d.pay_check(&agent(), once, 100).is_err());
    d.pay_check(&me(), once, 4_890).unwrap();
    let Reply::Secret { secret, fields, .. } =
        d.pay_finish(&me(), "Test shop", once, 4_890).unwrap()
    else {
        panic!("no card");
    };
    assert_eq!(secret.expose(), b"4242424242424242\n123");
    assert_eq!(fields["expiry"], "12/34");
    assert!(d.pay_check(&me(), once, 100).unwrap_err().contains("used"));
    let again = card(&mut d, false);
    d.pay_finish(&me(), "Test shop", again, 10_000).unwrap();
    d.pay_finish(&me(), "Test shop", again, 10_000).unwrap();
    // 48.90 + 100 + 100 spent: 100 more is over the month's 300.
    assert!(
        d.pay_check(&me(), again, 10_000)
            .unwrap_err()
            .contains("month")
    );
    let spending = ask(&mut d, &me(), json!({ "op": "spending" })).unwrap();
    assert_eq!(spending["spentThisMonth"], 24_890);
}

#[test]
fn limits_change_only_with_the_password() {
    let (mut d, _dir) = logged_in();
    let wrong = json!({ "op": "set-limits", "perPayment": 50_000, "perMonth": 90_000, "password": "d3Jvbmc=" });
    assert!(ask(&mut d, &me(), wrong).is_err());
    assert!(
        ask(
            &mut d,
            &agent(),
            json!({ "op": "set-limits", "perPayment": 1, "perMonth": 1, "password": PASSWORD })
        )
        .is_err()
    );
    let upside_down =
        json!({ "op": "set-limits", "perPayment": 500, "perMonth": 100, "password": PASSWORD });
    assert!(ask(&mut d, &me(), upside_down).is_err());
    ask(
        &mut d,
        &me(),
        json!({ "op": "set-limits", "perPayment": 500, "perMonth": 1000, "password": PASSWORD }),
    )
    .unwrap();
    let spending = ask(&mut d, &me(), json!({ "op": "spending" })).unwrap();
    assert_eq!(
        (spending["perPayment"].clone(), spending["perMonth"].clone()),
        (json!(500), json!(1000))
    );
    // The daemon never pays on its own say-so: pay goes through the person.
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "pay", "merchant": "x", "cents": 1, "card": 1 })
        )
        .is_err()
    );
}

#[test]
fn a_passkey_question_is_answered_yes_only_with_the_password() {
    use std::{
        io::{BufRead, BufReader},
        os::unix::net::UnixStream,
        sync::Mutex,
    };
    let (mut d, _dir) = logged_in();
    let (shell, ours) = UnixStream::pair().unwrap();
    d.approvals.watch(ME, Arc::new(Mutex::new(ours)));
    let approvals = d.approvals.clone();
    let what = json!({ "kind": "passkey-sign-in", "rp": "signin.localhost" });
    let asking = std::thread::spawn(move || approvals.ask(ME, what, |_| {}));
    let mut line = String::new();
    BufReader::new(shell).read_line(&mut line).unwrap();
    let id = serde_json::from_str::<Value>(&line).unwrap()["id"]
        .as_u64()
        .unwrap();
    // An agent can't answer; a wrong password doesn't; the right one does.
    assert!(
        ask(
            &mut d,
            &agent(),
            json!({ "op": "approve", "id": id, "password": PASSWORD })
        )
        .is_err()
    );
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "approve", "id": id, "password": "d3Jvbmc=" })
        )
        .is_err()
    );
    assert!(d.approvals.is_open(ME, id));
    ask(
        &mut d,
        &me(),
        json!({ "op": "approve", "id": id, "password": PASSWORD }),
    )
    .unwrap();
    assert!(asking.join().unwrap());
    // A question that's gone can't be answered again.
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "approve", "id": id, "password": PASSWORD })
        )
        .is_err()
    );
}

const ME: u32 = 1000;
const PASSWORD: &str = "Y29ycmVjdCBob3JzZQ=="; // "correct horse"

fn caller(uid: u32, cgroup: &str) -> Caller {
    Caller {
        uid,
        pid: 4242,
        cgroup: cgroup.into(),
    }
}

fn me() -> Caller {
    caller(ME, "/user.slice/user-1000.slice/session-2.scope")
}

fn agent() -> Caller {
    caller(
        ME,
        "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-claude-1.scope",
    )
}

fn root() -> Caller {
    caller(0, "/system.slice/greetd.service")
}

fn daemon() -> (Daemon, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Daemon::with_kdf(Store::new(dir.path()), Box::new(NoTpm), KdfParams::cheap);
    (daemon, dir)
}

fn ask(daemon: &mut Daemon, who: &Caller, request: Value) -> Result<Value, String> {
    let request: Request = serde_json::from_value(request).map_err(|e| e.to_string())?;
    let line = Reply::line(daemon.handle(who, request));
    let value: Value = serde_json::from_str(&line).unwrap();
    if value["ok"] == true {
        Ok(value)
    } else {
        Err(value["error"].as_str().unwrap_or("").to_string())
    }
}

fn logged_in() -> (Daemon, tempfile::TempDir) {
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

fn save_login(d: &mut Daemon, site: &str, account: &str, agents: &str) -> u64 {
    let r = ask(
        d,
        &me(),
        json!({ "op": "save-login", "site": site, "account": account, "password": "aHVudGVyMg==", "totp": "R0VaREdOQlZHWTNUUU9KUQ==", "agents": agents }),
    )
    .unwrap();
    r["id"].as_u64().unwrap()
}

#[test]
fn an_agent_is_refused_everything() {
    let (mut d, _dir) = logged_in();
    let id = save_login(&mut d, "github.com", "alexk", "ask");
    for request in [
        json!({ "op": "status" }),
        json!({ "op": "logins" }),
        json!({ "op": "reveal-password", "id": id }),
        json!({ "op": "code", "id": id }),
        json!({ "op": "search" }),
        json!({ "op": "app-secret", "appId": "org.example.App" }),
        json!({ "op": "verify", "password": PASSWORD }),
        json!({ "op": "lock-self" }),
    ] {
        let error = ask(&mut d, &agent(), request.clone()).unwrap_err();
        assert!(error.contains("agents may not"), "{request}: {error}");
    }
    // And as root, from an agent's cgroup, too.
    let agent_root = caller(0, "/user.slice/dashi-agent-x.scope");
    assert!(ask(&mut d, &agent_root, json!({ "op": "lock", "user": ME })).is_err());
    assert!(d.is_unlocked(ME));
}

#[test]
fn only_pam_unlocks_at_login_and_only_at_login_is_a_vault_made() {
    let (mut d, _dir) = daemon();
    // Running as you is not enough to make the vault (with a password of your choosing).
    let error = ask(
        &mut d,
        &me(),
        json!({ "op": "unlock", "user": ME, "password": PASSWORD }),
    )
    .unwrap_err();
    assert!(error.contains("PAM"));
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "unlock-self", "password": PASSWORD })
        )
        .is_err()
    );
    assert!(!d.is_unlocked(ME));
    // Root has no vault of its own.
    assert!(ask(&mut d, &root(), json!({ "op": "status" })).is_err());
    assert!(
        ask(
            &mut d,
            &root(),
            json!({ "op": "unlock", "user": 0, "password": PASSWORD })
        )
        .is_err()
    );
    ask(
        &mut d,
        &root(),
        json!({ "op": "unlock", "user": ME, "password": PASSWORD }),
    )
    .unwrap();
    let status = ask(&mut d, &me(), json!({ "op": "status" })).unwrap();
    assert_eq!(
        (status["exists"].clone(), status["unlocked"].clone()),
        (json!(true), json!(true))
    );
}

#[test]
fn a_locked_vault_answers_nothing_and_reopens_with_the_password() {
    let (mut d, _dir) = logged_in();
    save_login(&mut d, "github.com", "alexk", "ask");
    ask(&mut d, &root(), json!({ "op": "lock", "user": ME })).unwrap();
    assert!(
        ask(&mut d, &me(), json!({ "op": "logins" }))
            .unwrap_err()
            .contains("locked")
    );
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "unlock-self", "password": "d3Jvbmc=" })
        )
        .is_err()
    );
    ask(
        &mut d,
        &me(),
        json!({ "op": "unlock-self", "password": PASSWORD }),
    )
    .unwrap();
    assert_eq!(
        ask(&mut d, &me(), json!({ "op": "logins" })).unwrap()["logins"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn wrong_passwords_are_slowed_down() {
    let (mut d, _dir) = logged_in();
    for _ in 0..FREE_TRIES {
        assert_eq!(
            ask(
                &mut d,
                &me(),
                json!({ "op": "verify", "password": "d3Jvbmc=" })
            )
            .unwrap_err(),
            "wrong password"
        );
    }
    // Now even the right one waits.
    let error = ask(
        &mut d,
        &me(),
        json!({ "op": "verify", "password": PASSWORD }),
    )
    .unwrap_err();
    assert!(error.contains("too many"));
}

#[test]
fn each_person_reaches_only_their_own_vault() {
    let (mut d, _dir) = logged_in();
    save_login(&mut d, "github.com", "alexk", "ask");
    let other = caller(1001, "/user.slice/user-1001.slice/session-3.scope");
    assert!(
        ask(&mut d, &other, json!({ "op": "logins" }))
            .unwrap_err()
            .contains("locked")
    );
    assert_eq!(
        ask(&mut d, &other, json!({ "op": "status" })).unwrap()["exists"],
        false
    );
}

#[test]
fn logins_are_listed_without_secrets_most_recent_first() {
    let (mut d, _dir) = logged_in();
    let github = save_login(&mut d, "github.com", "alexk", "ask");
    save_login(&mut d, "gist.github.com", "alex-work", "ask");
    save_login(&mut d, "ynab.com", "alex@example.com", "ask");
    ask(&mut d, &me(), json!({ "op": "code", "id": github })).unwrap();
    let listed = ask(
        &mut d,
        &me(),
        json!({ "op": "logins", "site": "https://gist.github.com/x" }),
    )
    .unwrap();
    let text = listed.to_string();
    assert!(
        !text.contains("aHVudGVyMg") && !text.contains("hunter2") && !text.contains("R0VaREdO")
    );
    let logins = listed["logins"].as_array().unwrap();
    // A login for github.com also belongs on gist.github.com; ynab's doesn't.
    assert_eq!(logins.len(), 2);
    assert_eq!(logins[0]["account"], "alexk");
    assert_eq!(logins[0]["hasCode"], true);
    assert!(logins[0]["lastUsed"].is_u64() && logins[1]["lastUsed"].is_null());
}

#[test]
fn never_logins_are_refused_to_agents_and_codes_are_computed_here() {
    let (mut d, _dir) = logged_in();
    let bank = save_login(&mut d, "bank.example", "4471", "never");
    let error = ask(
        &mut d,
        &me(),
        json!({ "op": "reveal-password", "id": bank, "forAgent": true }),
    )
    .unwrap_err();
    assert!(error.contains("never"));
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "code", "id": bank, "forAgent": true })
        )
        .is_err()
    );
    // The person themselves (Settings) still may.
    let revealed = ask(
        &mut d,
        &me(),
        json!({ "op": "reveal-password", "id": bank }),
    )
    .unwrap();
    assert_eq!(revealed["password"], "aHVudGVyMg==");
    let code = ask(&mut d, &me(), json!({ "op": "code", "id": bank })).unwrap();
    let code = code["code"].as_str().unwrap();
    // The code is six digits, base64 in the reply like every secret.
    use base64::Engine;
    let digits = base64::engine::general_purpose::STANDARD
        .decode(code)
        .unwrap();
    assert_eq!(digits.len(), 6);
    assert!(digits.iter().all(u8::is_ascii_digit));
}

#[test]
fn the_secret_service_stores_and_finds_items() {
    let (mut d, _dir) = logged_in();
    let attrs = json!({ "application": "chrome" });
    let first = ask(&mut d, &me(), json!({ "op": "create-item", "collection": "login", "label": "Chrome", "attributes": attrs, "secret": "a2V5MQ==" })).unwrap();
    let again = ask(&mut d, &me(), json!({ "op": "create-item", "collection": "login", "label": "Chrome", "attributes": attrs, "secret": "a2V5Mg==", "replace": true })).unwrap();
    assert_eq!(first["id"], again["id"]);
    let found = ask(
        &mut d,
        &me(),
        json!({ "op": "search", "attributes": attrs }),
    )
    .unwrap();
    assert_eq!(found["items"].as_array().unwrap().len(), 1);
    assert!(!found.to_string().contains("a2V5"));
    let secret = ask(
        &mut d,
        &me(),
        json!({ "op": "get-secret", "id": first["id"] }),
    )
    .unwrap();
    assert_eq!(secret["secret"], "a2V5Mg==");
    assert!(
        ask(
            &mut d,
            &me(),
            json!({ "op": "create-item", "collection": "nope", "label": "x", "secret": "eA==" })
        )
        .is_err()
    );
}

#[test]
fn an_apps_portal_secret_is_made_once_and_kept() {
    let (mut d, dir) = logged_in();
    let one = ask(
        &mut d,
        &me(),
        json!({ "op": "app-secret", "appId": "org.example.App" }),
    )
    .unwrap();
    // Saved: it survives the daemon.
    let mut d2 = Daemon::with_kdf(Store::new(dir.path()), Box::new(NoTpm), KdfParams::cheap);
    ask(
        &mut d2,
        &root(),
        json!({ "op": "unlock", "user": ME, "password": PASSWORD }),
    )
    .unwrap();
    let two = ask(
        &mut d2,
        &me(),
        json!({ "op": "app-secret", "appId": "org.example.App" }),
    )
    .unwrap();
    assert_eq!(one["secret"], two["secret"]);
    assert_eq!(
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            one["secret"].as_str().unwrap()
        )
        .unwrap()
        .len(),
        64
    );
}

#[test]
fn bad_input_is_refused_without_changing_anything() {
    let (mut d, _dir) = logged_in();
    for request in [
        json!({ "op": "save-login", "site": "not a site", "account": "a", "password": "eA==" }),
        json!({ "op": "save-login", "site": "x.com", "account": "", "password": "eA==" }),
        json!({ "op": "save-login", "site": "x.com", "account": "a\u{7}", "password": "eA==" }),
        json!({ "op": "save-login", "site": "x.com", "account": "a", "password": "" }),
        json!({ "op": "save-login", "site": "x.com", "account": "a", "password": "eA==", "totp": "IT8/" }),
    ] {
        assert!(ask(&mut d, &me(), request).is_err());
    }
    assert!(
        ask(&mut d, &me(), json!({ "op": "logins" })).unwrap()["logins"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
