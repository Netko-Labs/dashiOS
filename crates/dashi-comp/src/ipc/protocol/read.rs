//! Reading a request's params into its type, and its reply out of one: serde,
//! with unknown fields refused, and an error that names the path to what was
//! wrong (`rules[3].when`).

use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

/// `value` as a `P`, or why not.
pub(crate) fn read<P: DeserializeOwned>(value: Value) -> Result<P, String> {
    serde_path_to_error::deserialize(value).map_err(|error| {
        let path = error.path().to_string();
        let inner = error.into_inner();
        if path == "." {
            inner.to_string()
        } else {
            format!("`{path}`: {inner}")
        }
    })
}

/// A reply as JSON.
pub(crate) fn write<R: Serialize>(reply: &R) -> Result<Value, String> {
    serde_json::to_value(reply).map_err(|error| error.to_string())
}

/// The reply of a request that only says it is done: `{}`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Done {}

/// The params of a request that takes none: `{}`.
pub(crate) type Nothing = Done;

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::json;

    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Rule {
        #[allow(dead_code)]
        when: String,
    }

    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Rules {
        #[allow(dead_code)]
        rules: Vec<Rule>,
    }

    #[test]
    fn a_refusal_names_the_path() {
        let error =
            read::<Rules>(json!({ "rules": [{ "when": "a" }, { "when": 4 }] })).unwrap_err();
        assert!(
            error.starts_with("`rules[1].when`: invalid type"),
            "{error}"
        );
        let error = read::<Rules>(json!({ "rules": [], "more": 1 })).unwrap_err();
        assert!(error.contains("unknown field `more`"), "{error}");
        assert!(read::<Nothing>(json!({})).is_ok());
        assert!(read::<Nothing>(json!({ "x": 1 })).is_err());
        assert_eq!(write(&Done {}).unwrap(), json!({}));
    }
}
