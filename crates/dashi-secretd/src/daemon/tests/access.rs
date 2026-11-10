//! Who may reach the daemon, when a vault is open, and how wrong passwords are slowed.

use super::{fixtures::*, *};

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
        json!({ "op": "tokens" }),
        json!({ "op": "token", "name": "github", "host": "api.github.com" }),
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
