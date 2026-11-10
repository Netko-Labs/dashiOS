//! Translating between the wire and the machine: errors, `SetSlash` values,
//! and the knob values of a `SetMany`.

use std::collections::HashMap;

use zbus::fdo;
use zbus::zvariant::{OwnedValue, Value};

use crate::knobs::{Knob, Value as KnobValue};
use crate::machine::OpError;
use crate::slash::{Change, Input};

pub(super) fn to_fdo(error: OpError) -> fdo::Error {
    match error {
        OpError::NotFound(s) => fdo::Error::InvalidArgs(format!("{s} is not on this machine")),
        OpError::Invalid(s) => fdo::Error::InvalidArgs(s),
        OpError::Io(s) => fdo::Error::Failed(s),
        OpError::Unavailable(s) => fdo::Error::NotSupported(s),
        OpError::NoDevice(s) => fdo::Error::NotSupported(s),
    }
}

/// The knobs a `SetMany` names, parsed, in the fixed write order (profile
/// first).
pub(super) fn knob_values(
    values: &HashMap<String, OwnedValue>,
) -> fdo::Result<Vec<(Knob, KnobValue)>> {
    let mut parsed = Vec::new();
    for knob in Knob::ALL {
        if let Some(raw) = values.get(knob.name()) {
            let value =
                KnobValue::from_variant(knob.kind(), raw).map_err(fdo::Error::InvalidArgs)?;
            parsed.push((knob, value));
        }
    }
    Ok(parsed)
}

/// The Slash bar change a `SetSlash` asks for, keys taken in sorted order.
pub(super) fn slash_change(values: &HashMap<String, OwnedValue>) -> fdo::Result<Change> {
    let mut change = Change::default();
    let mut keys: Vec<&String> = values.keys().collect();
    keys.sort();
    for key in keys {
        let input = slash_input(&values[key]).ok_or_else(|| {
            fdo::Error::InvalidArgs(format!("{key}: expected a boolean, number or string"))
        })?;
        change.put(key, input).map_err(fdo::Error::InvalidArgs)?;
    }
    Ok(change)
}

/// One `SetSlash` value: a boolean, an integer of any width, or a string.
fn slash_input(value: &Value<'_>) -> Option<Input> {
    let value = match value {
        Value::Value(inner) => inner.as_ref(),
        other => other,
    };
    Some(match value {
        Value::Bool(b) => Input::Bool(*b),
        Value::Str(s) => Input::Str(s.as_str().to_owned()),
        Value::U8(n) => Input::Int(i64::from(*n)),
        Value::U16(n) => Input::Int(i64::from(*n)),
        Value::U32(n) => Input::Int(i64::from(*n)),
        Value::U64(n) => Input::Int(i64::try_from(*n).unwrap_or(i64::MAX)),
        Value::I16(n) => Input::Int(i64::from(*n)),
        Value::I32(n) => Input::Int(i64::from(*n)),
        Value::I64(n) => Input::Int(*n),
        _ => return None,
    })
}
