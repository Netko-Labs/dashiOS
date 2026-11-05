//! CTAP2 (FIDO's Client to Authenticator Protocol 2.1): authenticatorGetInfo,
//! authenticatorMakeCredential and authenticatorGetAssertion, the three a
//! browser needs for passkeys. Every passkey is resident and P-256; there is
//! no PIN: user verification is built in (the fingerprint reader or the
//! login password, asked by `approve`), and every use asks.

use ciborium::Value;

use super::store::{self, AT, Found, UP, UV};
use crate::vault::Data;

pub const MAKE_CREDENTIAL: u8 = 0x01;
pub const GET_ASSERTION: u8 = 0x02;
pub const GET_INFO: u8 = 0x04;

pub const OK: u8 = 0x00;
pub const INVALID_COMMAND: u8 = 0x01;
pub const INVALID_CBOR: u8 = 0x12;
pub const MISSING_PARAMETER: u8 = 0x14;
pub const CREDENTIAL_EXCLUDED: u8 = 0x19;
pub const UNSUPPORTED_ALGORITHM: u8 = 0x26;
pub const OPERATION_DENIED: u8 = 0x27;
pub const INVALID_OPTION: u8 = 0x2c;
pub const NO_CREDENTIALS: u8 = 0x2e;
pub const PIN_AUTH_INVALID: u8 = 0x33;
pub const PIN_NOT_SET: u8 = 0x35;
/// The vault is locked, or failed.
pub const OTHER: u8 = 0x7f;

/// Dashi's virtual key's AAGUID.
pub const AAGUID: [u8; 16] = *b"dashi-vault-key1";
const ES256: i128 = -7;

/// What the person is asked before a passkey is made or used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ask {
    Register { rp_id: String, user: String },
    SignIn { rp_id: String, user: String },
}

/// Runs a closure on the unlocked vault (and saves it); false when there is none.
pub type WithVault<'a> = &'a dyn Fn(&mut dyn FnMut(&mut Data)) -> bool;

/// What a command needs: the vault (locked while `with` runs), the person's
/// answer (asked with no lock held), and the time.
pub struct Env<'a> {
    /// Runs `f` on the unlocked vault and saves it; false when there is none.
    pub with: WithVault<'a>,
    pub approve: &'a dyn Fn(&Ask) -> bool,
    pub now: u64,
}

type Map = Vec<(Value, Value)>;

fn get(map: &Map, key: i128) -> Option<&Value> {
    map.iter()
        .find(|(k, _)| k.as_integer().is_some_and(|k| i128::from(k) == key))
        .map(|(_, v)| v)
}

fn field<'a>(map: &'a Map, key: &str) -> Option<&'a Value> {
    map.iter()
        .find(|(k, _)| k.as_text() == Some(key))
        .map(|(_, v)| v)
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_text).map(str::to_owned)
}

fn bytes(value: Option<&Value>) -> Option<Vec<u8>> {
    value.and_then(Value::as_bytes).cloned()
}

fn encode(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    // Writing into a Vec can't fail.
    let _ = ciborium::into_writer(value, &mut out);
    out
}

fn reply(map: Map) -> Vec<u8> {
    let mut out = vec![OK];
    out.extend(encode(&Value::Map(map)));
    out
}

fn int(n: i64) -> Value {
    Value::Integer(n.into())
}

fn txt(s: &str) -> Value {
    Value::Text(s.into())
}

/// A COSE_Key for a P-256 public key, in CTAP2's canonical order.
fn cose_key(x: &[u8; 32], y: &[u8; 32]) -> Vec<u8> {
    encode(&Value::Map(vec![
        (int(1), int(2)),
        (int(3), int(-7)),
        (int(-1), int(1)),
        (int(-2), Value::Bytes(x.to_vec())),
        (int(-3), Value::Bytes(y.to_vec())),
    ]))
}

pub fn get_info() -> Vec<u8> {
    reply(vec![
        (int(1), Value::Array(vec![txt("FIDO_2_0")])),
        (int(3), Value::Bytes(AAGUID.to_vec())),
        (
            int(4),
            Value::Map(vec![
                (txt("rk"), Value::Bool(true)),
                (txt("up"), Value::Bool(true)),
                (txt("uv"), Value::Bool(true)),
                (txt("plat"), Value::Bool(false)),
            ]),
        ),
        (int(5), int(1200)),
        (int(9), Value::Array(vec![txt("usb")])),
        (
            int(10),
            Value::Array(vec![Value::Map(vec![
                (txt("alg"), int(-7)),
                (txt("type"), txt("public-key")),
            ])]),
        ),
    ])
}

fn parse(params: &[u8]) -> Result<Map, u8> {
    match ciborium::from_reader::<Value, _>(params) {
        Ok(Value::Map(map)) => Ok(map),
        _ => Err(INVALID_CBOR),
    }
}

/// A PIN/UV auth parameter: an empty one asks only for a touch (we have no PIN), any other is wrong.
fn pin_param(map: &Map, key: i128) -> Result<(), u8> {
    match get(map, key) {
        None => Ok(()),
        Some(Value::Bytes(b)) if b.is_empty() => Err(PIN_NOT_SET),
        Some(_) => Err(PIN_AUTH_INVALID),
    }
}

fn descriptor_ids(value: Option<&Value>) -> Vec<Vec<u8>> {
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

fn option(map: &Map, key: i128, name: &str) -> Option<bool> {
    get(map, key)
        .and_then(Value::as_map)
        .and_then(|options| field(options, name))
        .and_then(Value::as_bool)
}

pub fn make_credential(params: &[u8], env: &Env<'_>) -> Result<Vec<u8>, u8> {
    let map = parse(params)?;
    let client_data_hash = bytes(get(&map, 1))
        .filter(|h| h.len() == 32)
        .ok_or(MISSING_PARAMETER)?;
    let rp = get(&map, 2)
        .and_then(Value::as_map)
        .ok_or(MISSING_PARAMETER)?;
    let rp_id = text(field(rp, "id"))
        .filter(|id| !id.is_empty() && id.len() <= 253)
        .ok_or(MISSING_PARAMETER)?;
    let user = get(&map, 3)
        .and_then(Value::as_map)
        .ok_or(MISSING_PARAMETER)?;
    let user_handle = bytes(field(user, "id"))
        .filter(|id| !id.is_empty() && id.len() <= 64)
        .ok_or(MISSING_PARAMETER)?;
    let user_name = text(field(user, "name"))
        .or_else(|| text(field(user, "displayName")))
        .unwrap_or_default();
    let algorithms = get(&map, 4)
        .and_then(Value::as_array)
        .ok_or(MISSING_PARAMETER)?;
    let es256 = algorithms.iter().filter_map(Value::as_map).any(|p| {
        field(p, "alg")
            .and_then(Value::as_integer)
            .is_some_and(|a| i128::from(a) == ES256)
            && text(field(p, "type")).as_deref() == Some("public-key")
    });
    if !es256 {
        return Err(UNSUPPORTED_ALGORITHM);
    }
    pin_param(&map, 8)?;
    if option(&map, 7, "up") == Some(false) {
        return Err(INVALID_OPTION);
    }
    let exclude = descriptor_ids(get(&map, 5));
    if !exclude.is_empty() {
        let mut excluded = false;
        (env.with)(&mut |data| excluded = !store::find(data, &rp_id, &exclude).is_empty());
        if excluded {
            return Err(CREDENTIAL_EXCLUDED);
        }
    }
    let ask = Ask::Register {
        rp_id: rp_id.clone(),
        user: user_name.clone(),
    };
    if !(env.approve)(&ask) {
        return Err(OPERATION_DENIED);
    }
    let mut made = None;
    let unlocked = (env.with)(&mut |data| {
        made = store::create(data, &rp_id, &user_handle, &user_name, env.now).ok()
    });
    let (credential_id, x, y) = made.filter(|_| unlocked).ok_or(OTHER)?;
    let mut auth_data = store::rp_id_hash(&rp_id).to_vec();
    auth_data.push(UP | UV | AT);
    auth_data.extend_from_slice(&0u32.to_be_bytes());
    auth_data.extend_from_slice(&AAGUID);
    auth_data.extend_from_slice(&(credential_id.len() as u16).to_be_bytes());
    auth_data.extend_from_slice(&credential_id);
    auth_data.extend(cose_key(&x, &y));
    let _ = client_data_hash;
    Ok(reply(vec![
        (int(1), txt("none")),
        (int(2), Value::Bytes(auth_data)),
        (int(3), Value::Map(Vec::new())),
    ]))
}

pub fn get_assertion(params: &[u8], env: &Env<'_>) -> Result<Vec<u8>, u8> {
    let map = parse(params)?;
    let rp_id = text(get(&map, 1))
        .filter(|id| !id.is_empty())
        .ok_or(MISSING_PARAMETER)?;
    let client_data_hash = bytes(get(&map, 2))
        .filter(|h| h.len() == 32)
        .ok_or(MISSING_PARAMETER)?;
    let allow = descriptor_ids(get(&map, 3));
    pin_param(&map, 6)?;
    let mut found: Vec<Found> = Vec::new();
    if !(env.with)(&mut |data| found = store::find(data, &rp_id, &allow)) {
        return Err(OTHER);
    }
    let Some(chosen) = found.into_iter().next() else {
        return Err(NO_CREDENTIALS);
    };
    // Every use is asked about, even one that says it needs no presence.
    let ask = Ask::SignIn {
        rp_id: rp_id.clone(),
        user: chosen.user_name.clone(),
    };
    if !(env.approve)(&ask) {
        return Err(OPERATION_DENIED);
    }
    let up = if option(&map, 5, "up") == Some(false) {
        0
    } else {
        UP
    };
    let mut signed = None;
    (env.with)(&mut |data| {
        signed = store::sign(
            data,
            &chosen.credential_id,
            up | UV,
            &client_data_hash,
            env.now,
        )
        .ok()
    });
    let (auth_data, signature) = signed.ok_or(OTHER)?;
    Ok(reply(vec![
        (
            int(1),
            Value::Map(vec![
                (txt("id"), Value::Bytes(chosen.credential_id)),
                (txt("type"), txt("public-key")),
            ]),
        ),
        (int(2), Value::Bytes(auth_data)),
        (int(3), Value::Bytes(signature)),
        (
            int(4),
            Value::Map(vec![
                (txt("id"), Value::Bytes(chosen.user_handle)),
                (txt("name"), txt(&chosen.user_name)),
            ]),
        ),
    ]))
}

/// A CTAPHID CBOR message (its first byte the command), answered: a status byte, then CBOR.
pub fn handle(message: &[u8], env: &Env<'_>) -> Vec<u8> {
    let Some((&command, params)) = message.split_first() else {
        return vec![INVALID_COMMAND];
    };
    let result = match command {
        GET_INFO => Ok(get_info()),
        MAKE_CREDENTIAL => make_credential(params, env),
        GET_ASSERTION => get_assertion(params, env),
        _ => Err(INVALID_COMMAND),
    };
    result.unwrap_or_else(|status| vec![status])
}

#[cfg(test)]
mod tests;
