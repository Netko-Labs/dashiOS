//! authenticatorGetAssertion: signing in with a passkey, once the person says yes.

use ciborium::Value;

use super::{
    Ask, Env,
    cbor::{bytes, descriptor_ids, get, int, option, parse, pin_param, reply, text, txt},
    status::{MISSING_PARAMETER, NO_CREDENTIALS, OPERATION_DENIED, OTHER},
};
use crate::fido::store::{self, Found, UP, UV};

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
