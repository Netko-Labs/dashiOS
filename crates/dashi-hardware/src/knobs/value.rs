//! A knob's value: `s`, `u` or `b` on D-Bus, a string on the command line,
//! JSON in `Describe` and the saved state.

use std::fmt;

use zbus::zvariant::{OwnedValue, Value as Variant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Value {
    Str(String),
    U32(u32),
    Bool(bool),
}

/// Which of the three types a knob takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Str,
    U32,
    Bool,
}

impl Value {
    pub(crate) fn json(&self) -> serde_json::Value {
        match self {
            Value::Str(s) => serde_json::Value::from(s.as_str()),
            Value::U32(n) => serde_json::Value::from(*n),
            Value::Bool(b) => serde_json::Value::from(*b),
        }
    }

    pub(crate) fn variant(&self) -> OwnedValue {
        match self {
            Value::Str(s) => OwnedValue::try_from(Variant::from(s.as_str()))
                .expect("a string variant has no file descriptors to duplicate"),
            Value::U32(n) => OwnedValue::from(*n),
            Value::Bool(b) => OwnedValue::from(*b),
        }
    }

    /// A D-Bus value for a knob of `kind`. Integers of any width and sign
    /// are taken for `u` when they fit; nothing else converts.
    pub(crate) fn from_variant(kind: Kind, value: &Variant<'_>) -> Result<Self, String> {
        let value = match value {
            Variant::Value(inner) => inner.as_ref(),
            other => other,
        };
        let number: Option<i64> = match value {
            Variant::U8(n) => Some(i64::from(*n)),
            Variant::U16(n) => Some(i64::from(*n)),
            Variant::U32(n) => Some(i64::from(*n)),
            Variant::U64(n) => i64::try_from(*n).ok(),
            Variant::I16(n) => Some(i64::from(*n)),
            Variant::I32(n) => Some(i64::from(*n)),
            Variant::I64(n) => Some(*n),
            _ => None,
        };
        match (kind, value) {
            (Kind::Str, Variant::Str(s)) => Ok(Value::Str(s.as_str().to_owned())),
            (Kind::Bool, Variant::Bool(b)) => Ok(Value::Bool(*b)),
            (Kind::U32, _) => number
                .and_then(|n| u32::try_from(n).ok())
                .map(Value::U32)
                .ok_or_else(|| "expected an unsigned 32-bit number".to_owned()),
            (Kind::Str, _) => Err("expected a string".into()),
            (Kind::Bool, _) => Err("expected a boolean".into()),
        }
    }

    /// A command-line or JSON-recipe word for a knob of `kind`.
    pub(crate) fn parse(kind: Kind, text: &str) -> Result<Self, String> {
        match kind {
            Kind::Str => Ok(Value::Str(text.to_owned())),
            Kind::U32 => text
                .parse()
                .map(Value::U32)
                .map_err(|_| format!("{text}: expected an unsigned number")),
            Kind::Bool => match text {
                "1" | "true" | "on" | "yes" => Ok(Value::Bool(true)),
                "0" | "false" | "off" | "no" => Ok(Value::Bool(false)),
                _ => Err(format!("{text}: expected true or false")),
            },
        }
    }

    pub(crate) fn from_json(kind: Kind, value: &serde_json::Value) -> Option<Self> {
        match (kind, value) {
            (Kind::Str, serde_json::Value::String(s)) => Some(Value::Str(s.clone())),
            (Kind::U32, serde_json::Value::Number(n)) => n
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .map(Value::U32),
            (Kind::Bool, serde_json::Value::Bool(b)) => Some(Value::Bool(*b)),
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Str(s) => f.write_str(s),
            Value::U32(n) => write!(f, "{n}"),
            Value::Bool(b) => write!(f, "{b}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_of_any_width_become_u32_when_they_fit() {
        let from = |v: Variant<'_>| Value::from_variant(Kind::U32, &v);
        assert_eq!(from(Variant::from(80u32)), Ok(Value::U32(80)));
        assert_eq!(from(Variant::from(80i32)), Ok(Value::U32(80)));
        assert_eq!(from(Variant::from(80u64)), Ok(Value::U32(80)));
        assert!(from(Variant::from(-1i32)).is_err());
        assert!(from(Variant::from("80")).is_err());
    }

    #[test]
    fn words_parse_by_kind() {
        assert_eq!(Value::parse(Kind::Bool, "off"), Ok(Value::Bool(false)));
        assert_eq!(Value::parse(Kind::U32, "45"), Ok(Value::U32(45)));
        assert!(Value::parse(Kind::U32, "-5").is_err());
        assert_eq!(
            Value::parse(Kind::Str, "balanced"),
            Ok(Value::Str("balanced".into()))
        );
    }
}
