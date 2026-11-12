//! Payments, spending limits and the questions put to the person.

use std::sync::Arc;

use super::{fixtures::*, *};

/// Stripe's test card number, which no bank takes.
const TEST_CARD: &str = "NDI0MjQyNDI0MjQyNDI0Mg=="; // 4242424242424242
const CVC: &str = "MTIz"; // 123

pub(super) fn card(d: &mut Daemon, single_use: bool) -> u64 {
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
