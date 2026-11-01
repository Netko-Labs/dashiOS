//! IPC framing (docs/compositor-ipc.md): newline-delimited JSON. A request is
//! `{"id", "method", "params"}`; each gets exactly one reply, `{"id", "result"}`
//! or `{"id", "error"}`. Everything from a client is untrusted: a line that is
//! not a request gets an error reply when it has an id, and is dropped when not.

use serde_json::{Map, Value, json};

/// A line longer than this ends the connection: no request is that big.
pub(crate) const MAX_LINE: usize = 1 << 20;

/// Splits a byte stream into lines.
#[derive(Default)]
pub(crate) struct LineBuffer {
    pending: Vec<u8>,
}

impl LineBuffer {
    /// The whole lines in `chunk` (and what came before it); Err when a line outgrows `MAX_LINE`.
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, TooLong> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=end).collect();
            lines.push(String::from_utf8_lossy(&line[..end]).into_owned());
        }
        if self.pending.len() > MAX_LINE {
            return Err(TooLong);
        }
        Ok(lines)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TooLong;

#[derive(Debug, PartialEq)]
pub(crate) struct Request {
    pub id: u64,
    pub method: String,
    pub params: Map<String, Value>,
}

/// Why a line is not a request: with its id when it had one, so the error can be answered.
#[derive(Debug, PartialEq)]
pub(crate) struct Malformed {
    pub id: Option<u64>,
    pub error: String,
}

pub(crate) fn parse_request(line: &str) -> Result<Request, Malformed> {
    let value: Value = serde_json::from_str(line).map_err(|error| Malformed {
        id: None,
        error: format!("not JSON: {error}"),
    })?;
    let Value::Object(mut object) = value else {
        return Err(Malformed {
            id: None,
            error: "a request is a JSON object".into(),
        });
    };
    let id = object.get("id").and_then(Value::as_u64);
    let Some(id) = id else {
        return Err(Malformed {
            id: None,
            error: "a request needs a non-negative integer id".into(),
        });
    };
    let method = match object.remove("method") {
        Some(Value::String(method)) => method,
        _ => {
            return Err(Malformed {
                id: Some(id),
                error: "a request needs a method".into(),
            });
        }
    };
    let params = match object.remove("params") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(params)) => params,
        Some(_) => {
            return Err(Malformed {
                id: Some(id),
                error: "params must be an object".into(),
            });
        }
    };
    Ok(Request { id, method, params })
}

/// A reply line, newline included.
pub(crate) fn reply(id: u64, outcome: Result<Value, String>) -> String {
    let message = match outcome {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(error) => json!({ "id": id, "error": error }),
    };
    format!("{message}\n")
}

/// An event line, newline included: `{"event": name, ...fields}`.
pub(crate) fn event(name: &str, fields: Value) -> String {
    let mut object = match fields {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    object.insert("event".into(), Value::String(name.into()));
    format!("{}\n", Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_split_across_chunks() {
        let mut buffer = LineBuffer::default();
        assert_eq!(
            buffer.push(b"{\"a\":1}\n{\"b\"").unwrap(),
            vec!["{\"a\":1}"]
        );
        assert_eq!(buffer.push(b":2}\n\n").unwrap(), vec!["{\"b\":2}", ""]);
    }

    #[test]
    fn an_endless_line_is_refused() {
        let mut buffer = LineBuffer::default();
        assert_eq!(buffer.push(&vec![b'x'; MAX_LINE + 1]), Err(TooLong));
    }

    #[test]
    fn requests_parse() {
        let request = parse_request(r#"{"id":3,"method":"focus","params":{"window":7}}"#).unwrap();
        assert_eq!(request.id, 3);
        assert_eq!(request.method, "focus");
        assert_eq!(request.params.get("window"), Some(&json!(7)));
        assert_eq!(
            parse_request(r#"{"id":1,"method":"windows"}"#)
                .unwrap()
                .params,
            Map::new()
        );
    }

    #[test]
    fn malformed_requests_keep_their_id_when_they_have_one() {
        assert_eq!(parse_request("nope").unwrap_err().id, None);
        assert_eq!(parse_request(r#"{"method":"x"}"#).unwrap_err().id, None);
        assert_eq!(
            parse_request(r#"{"id":-1,"method":"x"}"#).unwrap_err().id,
            None
        );
        assert_eq!(parse_request(r#"{"id":4}"#).unwrap_err().id, Some(4));
        assert_eq!(
            parse_request(r#"{"id":5,"method":"x","params":[1]}"#)
                .unwrap_err()
                .id,
            Some(5)
        );
    }

    #[test]
    fn replies_and_events_are_one_line() {
        assert_eq!(reply(2, Ok(json!({}))), "{\"id\":2,\"result\":{}}\n");
        assert_eq!(reply(2, Err("no".into())), "{\"error\":\"no\",\"id\":2}\n");
        assert_eq!(
            event("window-closed", json!({"id": 9})),
            "{\"event\":\"window-closed\",\"id\":9}\n"
        );
    }
}
