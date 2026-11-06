//! CTAP2 messages, both ways, against a vault in memory.

use std::{cell::RefCell, sync::Mutex};

use ciborium::Value;
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};

use super::*;
use crate::vault::Data;

struct Harness {
    data: Mutex<Data>,
    asked: RefCell<Vec<Ask>>,
    allow: bool,
}

impl Harness {
    fn new(allow: bool) -> Self {
        Self {
            data: Mutex::new(Data::default()),
            asked: RefCell::new(Vec::new()),
            allow,
        }
    }

    fn run(&self, message: &[u8]) -> Vec<u8> {
        let with = |f: &mut dyn FnMut(&mut Data)| {
            f(&mut self.data.lock().unwrap());
            true
        };
        let approve = |ask: &Ask| {
            self.asked.borrow_mut().push(ask.clone());
            self.allow
        };
        handle(
            message,
            &Env {
                with: &with,
                approve: &approve,
                now: 1000,
            },
        )
    }
}

fn cbor(value: Value) -> Vec<u8> {
    super::encode(&value)
}

fn t(s: &str) -> Value {
    Value::Text(s.into())
}

fn i(n: i64) -> Value {
    Value::Integer(n.into())
}

fn make_request(rp: &str, user: &[u8], algs: &[i64]) -> Vec<u8> {
    let mut message = vec![MAKE_CREDENTIAL];
    message.extend(cbor(Value::Map(vec![
        (i(1), Value::Bytes(vec![7; 32])),
        (
            i(2),
            Value::Map(vec![(t("id"), t(rp)), (t("name"), t("Test site"))]),
        ),
        (
            i(3),
            Value::Map(vec![
                (t("id"), Value::Bytes(user.to_vec())),
                (t("name"), t("alexk")),
            ]),
        ),
        (
            i(4),
            Value::Array(
                algs.iter()
                    .map(|a| Value::Map(vec![(t("alg"), i(*a)), (t("type"), t("public-key"))]))
                    .collect(),
            ),
        ),
        (i(7), Value::Map(vec![(t("rk"), Value::Bool(true))])),
    ])));
    message
}

fn assert_request(rp: &str, allow: Option<&[u8]>, hash: &[u8; 32]) -> Vec<u8> {
    let mut map = vec![(i(1), t(rp)), (i(2), Value::Bytes(hash.to_vec()))];
    if let Some(id) = allow {
        map.push((
            i(3),
            Value::Array(vec![Value::Map(vec![
                (t("id"), Value::Bytes(id.to_vec())),
                (t("type"), t("public-key")),
            ])]),
        ));
    }
    let mut message = vec![GET_ASSERTION];
    message.extend(cbor(Value::Map(map)));
    message
}

fn decode(reply: &[u8]) -> Vec<(Value, Value)> {
    assert_eq!(reply[0], OK, "status {:#x}", reply[0]);
    match ciborium::from_reader::<Value, _>(&reply[1..]).unwrap() {
        Value::Map(map) => map,
        other => panic!("not a map: {other:?}"),
    }
}

fn get_bytes(map: &[(Value, Value)], key: i64) -> Vec<u8> {
    map.iter()
        .find(|(k, _)| *k == i(key))
        .and_then(|(_, v)| v.as_bytes().cloned())
        .unwrap()
}

/// The credential id and public key in makeCredential's authenticatorData.
fn attested(auth_data: &[u8]) -> (Vec<u8>, VerifyingKey) {
    let len = usize::from(u16::from_be_bytes([auth_data[53], auth_data[54]]));
    let id = auth_data[55..55 + len].to_vec();
    let cose: Value = ciborium::from_reader(&auth_data[55 + len..]).unwrap();
    let map = cose.as_map().unwrap().clone();
    let x = get_bytes(&map, -2);
    let y = get_bytes(&map, -3);
    let mut sec1 = vec![4u8];
    sec1.extend(x);
    sec1.extend(y);
    (id, VerifyingKey::from_sec1_bytes(&sec1).unwrap())
}

#[test]
fn get_info_says_what_this_key_is() {
    let map = decode(&Harness::new(true).run(&[GET_INFO]));
    let versions = &map.iter().find(|(k, _)| *k == i(1)).unwrap().1;
    assert_eq!(versions, &Value::Array(vec![t("FIDO_2_0")]));
    assert_eq!(get_bytes(&map, 3), AAGUID.to_vec());
}

#[test]
fn a_passkey_is_made_then_signs_in_for_its_site_only() {
    let h = Harness::new(true);
    let made = decode(&h.run(&make_request("signin.localhost", b"user-1", &[-8, -7])));
    let auth_data = get_bytes(&made, 2);
    assert_eq!(&auth_data[..32], &store::rp_id_hash("signin.localhost"));
    assert_eq!(auth_data[32], UP | UV | AT);
    assert_eq!(&auth_data[37..53], &AAGUID);
    let (credential_id, public_key) = attested(&auth_data);

    let hash = [9u8; 32];
    let assertion = decode(&h.run(&assert_request(
        "signin.localhost",
        Some(&credential_id),
        &hash,
    )));
    let auth = get_bytes(&assertion, 2);
    assert_eq!(&auth[..32], &store::rp_id_hash("signin.localhost"));
    assert_eq!(auth[32], UP | UV);
    assert_eq!(
        u32::from_be_bytes([auth[33], auth[34], auth[35], auth[36]]),
        1
    );
    let signature = Signature::from_der(&get_bytes(&assertion, 3)).unwrap();
    let mut signed = auth.clone();
    signed.extend_from_slice(&hash);
    public_key.verify(&signed, &signature).unwrap();
    // The count goes up each time.
    let again = decode(&h.run(&assert_request("signin.localhost", None, &hash)));
    assert_eq!(get_bytes(&again, 2)[36], 2);
    assert_eq!(
        *h.asked.borrow(),
        vec![
            Ask::Register {
                rp_id: "signin.localhost".into(),
                user: "alexk".into()
            },
            Ask::SignIn {
                rp_id: "signin.localhost".into(),
                user: "alexk".into()
            },
            Ask::SignIn {
                rp_id: "signin.localhost".into(),
                user: "alexk".into()
            },
        ]
    );
    // Another site gets nothing: a passkey is bound to its site.
    assert_eq!(
        h.run(&assert_request("evil.example", None, &hash)),
        vec![NO_CREDENTIALS]
    );
    assert_eq!(
        h.run(&assert_request("signin.localhost", Some(&[1, 2, 3]), &hash)),
        vec![NO_CREDENTIALS]
    );
}

#[test]
fn nothing_is_made_or_signed_without_the_person() {
    let h = Harness::new(false);
    assert_eq!(
        h.run(&make_request("signin.localhost", b"u", &[-7])),
        vec![OPERATION_DENIED]
    );
    assert!(h.data.lock().unwrap().passkeys.is_empty());
    let yes = Harness::new(true);
    yes.run(&make_request("signin.localhost", b"u", &[-7]));
    let no = Harness {
        data: Mutex::new(std::mem::take(&mut yes.data.lock().unwrap())),
        asked: RefCell::new(Vec::new()),
        allow: false,
    };
    assert_eq!(
        no.run(&assert_request("signin.localhost", None, &[0; 32])),
        vec![OPERATION_DENIED]
    );
    assert_eq!(no.data.lock().unwrap().passkeys[0].sign_count, 0);
}

#[test]
fn the_private_key_never_leaves() {
    let h = Harness::new(true);
    let made = h.run(&make_request("signin.localhost", b"u", &[-7]));
    let used = h.run(&assert_request("signin.localhost", None, &[3; 32]));
    let key = h.data.lock().unwrap().passkeys[0]
        .private_key
        .expose()
        .to_vec();
    for reply in [made, used] {
        assert!(!reply.windows(key.len()).any(|w| w == key.as_slice()));
    }
}

#[test]
fn bad_requests_get_their_errors() {
    let h = Harness::new(true);
    assert_eq!(
        h.run(&make_request("signin.localhost", b"u", &[-257])),
        vec![UNSUPPORTED_ALGORITHM]
    );
    assert_eq!(h.run(&[MAKE_CREDENTIAL, 0xff, 0x00]), vec![INVALID_CBOR]);
    assert_eq!(h.run(&[GET_ASSERTION, 0xa0]), vec![MISSING_PARAMETER]);
    assert_eq!(h.run(&[0x42]), vec![INVALID_COMMAND]);
    assert_eq!(h.run(&[]), vec![INVALID_COMMAND]);
    // A PIN this key doesn't have.
    let mut with_pin = vec![GET_ASSERTION];
    with_pin.extend(cbor(Value::Map(vec![
        (i(1), t("a.example")),
        (i(2), Value::Bytes(vec![0; 32])),
        (i(6), Value::Bytes(vec![1; 16])),
    ])));
    assert_eq!(h.run(&with_pin), vec![PIN_AUTH_INVALID]);
    assert!(h.asked.borrow().is_empty());
}

#[test]
fn a_registered_credential_is_excluded() {
    let h = Harness::new(true);
    let made = decode(&h.run(&make_request("signin.localhost", b"u", &[-7])));
    let (credential_id, _) = attested(&get_bytes(&made, 2));
    let mut request = make_request("signin.localhost", b"u", &[-7]);
    let mut map: Vec<(Value, Value)> = ciborium::from_reader::<Value, _>(&request[1..])
        .unwrap()
        .as_map()
        .unwrap()
        .clone();
    map.push((
        i(5),
        Value::Array(vec![Value::Map(vec![
            (t("id"), Value::Bytes(credential_id)),
            (t("type"), t("public-key")),
        ])]),
    ));
    request.truncate(1);
    request.extend(cbor(Value::Map(map)));
    assert_eq!(h.run(&request), vec![CREDENTIAL_EXCLUDED]);
}
