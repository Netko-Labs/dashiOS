//! Reading a request's params: each is untrusted, checked before anything changes.

use serde_json::{Map, Value};

pub(crate) type Params = Map<String, Value>;

pub(crate) fn window(params: &Params) -> Result<u64, String> {
    params
        .get("window")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(|| "`window` must be a window id".into())
}

pub(crate) fn int(params: &Params, key: &str) -> Result<i64, String> {
    let value = params
        .get(key)
        .ok_or_else(|| format!("`{key}` is required"))?;
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|v| v.is_finite())
                .map(|v| v.round() as i64)
        })
        .ok_or_else(|| format!("`{key}` must be a number"))
}

pub(crate) fn coord(params: &Params, key: &str) -> Result<i32, String> {
    let value = int(params, key)?;
    i32::try_from(value)
        .ok()
        .filter(|v| v.abs() <= 1 << 16)
        .ok_or_else(|| format!("`{key}` is out of range"))
}

pub(crate) fn number(params: &Params, key: &str) -> Result<f64, String> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("`{key}` must be a number"))
}

pub(crate) fn text<'a>(params: &'a Params, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("`{key}` must be a string"))
}

pub(crate) fn flag(params: &Params, key: &str) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// A required `true` or `false`.
pub(crate) fn on(params: &Params, key: &str) -> Result<bool, String> {
    params
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("`{key}` must be true or false"))
}

/// An index (a Space's, a count), absent or a non-negative integer.
pub(crate) fn index(params: &Params, key: &str, what: &str) -> Result<Option<usize>, String> {
    match params.get(key) {
        None => Ok(None),
        Some(value) => value
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
            .map(Some)
            .ok_or_else(|| format!("`{key}` must be {what}")),
    }
}

/// A Space's index, required.
pub(crate) fn space(params: &Params) -> Result<usize, String> {
    index(params, "space", "a Space's index")?
        .ok_or_else(|| "`space` must be a Space's index".into())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn params(value: Value) -> Params {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn window_ids_are_positive_integers() {
        assert_eq!(window(&params(json!({ "window": 4 }))), Ok(4));
        assert!(window(&params(json!({ "window": 0 }))).is_err());
        assert!(window(&params(json!({ "window": "4" }))).is_err());
        assert!(window(&params(json!({}))).is_err());
    }

    #[test]
    fn numbers_round_and_coordinates_stay_in_range() {
        assert_eq!(int(&params(json!({ "x": 10.6 })), "x"), Ok(11));
        assert!(int(&params(json!({ "x": "10" })), "x").is_err());
        assert_eq!(coord(&params(json!({ "y": -40 })), "y"), Ok(-40));
        assert!(coord(&params(json!({ "y": 1e12 })), "y").is_err());
        assert!(number(&params(json!({ "scale": null })), "scale").is_err());
    }

    #[test]
    fn indexes_are_absent_or_whole() {
        assert_eq!(index(&params(json!({})), "at", "x"), Ok(None));
        assert_eq!(index(&params(json!({ "at": 2 })), "at", "x"), Ok(Some(2)));
        assert!(index(&params(json!({ "at": -1 })), "at", "x").is_err());
        assert!(space(&params(json!({}))).is_err());
        assert_eq!(on(&params(json!({ "on": true })), "on"), Ok(true));
        assert!(on(&params(json!({ "on": 1 })), "on").is_err());
    }
}
