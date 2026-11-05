//! Replies, as the lines that go back. A reply that carries a secret is built
//! straight into memory that is zeroed afterwards; the rest are plain JSON.

use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::vault::bytes::Secret;

pub enum Reply {
    Plain(Value),
    /// `fields`, plus `key` holding `secret` (as base64).
    Secret {
        fields: Value,
        key: &'static str,
        secret: Secret,
    },
}

impl Reply {
    pub fn ok() -> Self {
        Reply::Plain(json!({}))
    }

    /// The reply line, `{"ok": true, ...}` or `{"ok": false, "error": ...}`.
    pub fn line(result: Result<Reply, String>) -> Zeroizing<String> {
        let reply = match result {
            Err(error) => {
                return Zeroizing::new(json!({ "ok": false, "error": error }).to_string());
            }
            Ok(reply) => reply,
        };
        let (mut fields, extra) = match reply {
            Reply::Plain(fields) => (fields, None),
            Reply::Secret {
                fields,
                key,
                secret,
            } => (fields, Some((key, secret))),
        };
        if let Value::Object(map) = &mut fields {
            map.insert("ok".into(), Value::Bool(true));
        } else {
            fields = json!({ "ok": true, "value": fields });
        }
        let mut line = Zeroizing::new(fields.to_string());
        if let Some((key, secret)) = extra {
            // `{...}` becomes `{...,"key":"<base64>"}`; the key is ours, the value base64.
            let encoded = Zeroizing::new(serde_json::to_string(&secret).unwrap_or_default());
            line.pop();
            line.push_str(",\"");
            line.push_str(key);
            line.push_str("\":");
            line.push_str(&encoded);
            line.push('}');
        }
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_are_one_json_object() {
        let line = Reply::line(Ok(Reply::Secret {
            fields: json!({ "contentType": "text/plain" }),
            key: "secret",
            secret: Secret::new(b"pw".to_vec()),
        }));
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["secret"], "cHc=");
        assert_eq!(value["contentType"], "text/plain");
        let line = Reply::line(Err("locked".into()));
        assert_eq!(&*line, r#"{"error":"locked","ok":false}"#);
    }
}
