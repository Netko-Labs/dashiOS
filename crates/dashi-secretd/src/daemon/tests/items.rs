//! Logins, codes and the secret service: what is listed, revealed and refused.

use super::{fixtures::*, *};

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
