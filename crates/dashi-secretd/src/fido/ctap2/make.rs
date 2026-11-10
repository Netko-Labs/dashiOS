//! authenticatorMakeCredential: a new passkey, once the person says yes.

use ciborium::Value;

use super::{
    Ask, Env,
    cbor::{
        bytes, cose_key, descriptor_ids, field, get, int, option, parse, pin_param, reply, text,
        txt,
    },
    status::{
        AAGUID, CREDENTIAL_EXCLUDED, INVALID_OPTION, MISSING_PARAMETER, OPERATION_DENIED, OTHER,
        UNSUPPORTED_ALGORITHM,
    },
};
use crate::fido::store::{self, AT, UP, UV};

const ES256: i128 = -7;

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
