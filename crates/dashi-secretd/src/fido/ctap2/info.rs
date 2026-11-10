//! authenticatorGetInfo: what this key can do.

use ciborium::Value;

use super::{
    cbor::{int, reply, txt},
    status::AAGUID,
};

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
