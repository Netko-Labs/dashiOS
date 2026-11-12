//! CBOR in and out: reading request fields, writing replies, and the COSE key.

use ciborium::Value;

use super::status::{INVALID_CBOR, OK, PIN_AUTH_INVALID, PIN_NOT_SET};

pub(super) type Map = Vec<(Value, Value)>;

pub(super) fn get(map: &Map, key: i128) -> Option<&Value> {
    map.iter()
        .find(|(k, _)| k.as_integer().is_some_and(|k| i128::from(k) == key))
        .map(|(_, v)| v)
}

pub(super) fn field<'a>(map: &'a Map, key: &str) -> Option<&'a Value> {
    map.iter()
        .find(|(k, _)| k.as_text() == Some(key))
        .map(|(_, v)| v)
}

pub(super) fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_text).map(str::to_owned)
}

pub(super) fn bytes(value: Option<&Value>) -> Option<Vec<u8>> {
    value.and_then(Value::as_bytes).cloned()
}

pub(super) fn encode(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    // Writing into a Vec can't fail.
    let _ = ciborium::into_writer(value, &mut out);
    out
}

pub(super) fn reply(map: Map) -> Vec<u8> {
    let mut out = vec![OK];
    out.extend(encode(&Value::Map(map)));
    out
}

pub(super) fn int(n: i64) -> Value {
    Value::Integer(n.into())
}

pub(super) fn txt(s: &str) -> Value {
    Value::Text(s.into())
}

/// A COSE_Key for a P-256 public key, in CTAP2's canonical order.
pub(super) fn cose_key(x: &[u8; 32], y: &[u8; 32]) -> Vec<u8> {
    encode(&Value::Map(vec![
        (int(1), int(2)),
        (int(3), int(-7)),
        (int(-1), int(1)),
        (int(-2), Value::Bytes(x.to_vec())),
        (int(-3), Value::Bytes(y.to_vec())),
    ]))
}

pub(super) fn parse(params: &[u8]) -> Result<Map, u8> {
    match ciborium::from_reader::<Value, _>(params) {
        Ok(Value::Map(map)) => Ok(map),
        _ => Err(INVALID_CBOR),
    }
}

/// A PIN/UV auth parameter: an empty one asks only for a touch (we have no PIN), any other is wrong.
pub(super) fn pin_param(map: &Map, key: i128) -> Result<(), u8> {
    match get(map, key) {
        None => Ok(()),
        Some(Value::Bytes(b)) if b.is_empty() => Err(PIN_NOT_SET),
        Some(_) => Err(PIN_AUTH_INVALID),
    }
}

pub(super) fn descriptor_ids(value: Option<&Value>) -> Vec<Vec<u8>> {
    value
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_map)
                .filter_map(|d| bytes(field(d, "id")))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn option(map: &Map, key: i128, name: &str) -> Option<bool> {
    get(map, key)
        .and_then(Value::as_map)
        .and_then(|options| field(options, name))
        .and_then(Value::as_bool)
}
