//! What the shell asks of dashi-camera, one JSON object per line on stdin,
//! and how it is answered on stdout (docs/camera.md, "The service"):
//!
//!   {"id": 1, "method": "open", "params": {"camera": "<PipeWire target>", "preview": "dashi-camera-preview"}}
//!   {"id": 1, "result": {"width": 1280, "height": 720}}
//!   {"id": 2, "error": "the camera did not start"}
//!   {"event": "error", "message": "…"}
//!
//! Every line is checked before anything is done with it: an id, a known
//! method, and params of the right shape. Paths are absolute, with no NUL,
//! and are never overwritten (`still.rs`, `recording.rs`). The shell decides
//! everything here (which camera, where files go, whether the microphone
//! records); dashi-camera only does what it is told.

use std::path::PathBuf;

use serde_json::{Map, Value, json};

/// The PipeWire node name the preview is published as unless the shell names another.
pub const PREVIEW: &str = "dashi-camera-preview";

#[derive(Debug, PartialEq)]
pub enum Request {
    /// Start the camera (a PipeWire target: a node name or object serial) and publish its preview.
    Open { camera: String, preview: String },
    /// Stop the camera; a recording in progress is finished first.
    Close,
    /// A photo of the latest frame to `path` (JPEG), and a small copy to `poster`.
    Photo { path: PathBuf, poster: PathBuf },
    /// Start recording to `path` (MP4); `poster` gets the first frame, small.
    Record {
        path: PathBuf,
        poster: PathBuf,
        microphone: bool,
    },
    /// Finish the recording.
    Stop,
    /// Which encoders a recording would use.
    Encoders,
}

/// One line from the shell: its id and the request, or the id (when there was one) and why not.
pub fn parse(line: &str) -> Result<(u64, Request), (Option<u64>, String)> {
    let value: Value = serde_json::from_str(line).map_err(|_| (None, "not JSON".to_string()))?;
    let object = value
        .as_object()
        .ok_or((None, "not an object".to_string()))?;
    let id = object
        .get("id")
        .and_then(Value::as_u64)
        .ok_or((None, "no id".to_string()))?;
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .ok_or((Some(id), "no method".to_string()))?;
    let empty = Map::new();
    let params = match object.get("params") {
        None => &empty,
        Some(Value::Object(params)) => params,
        Some(_) => return Err((Some(id), "params must be an object".into())),
    };
    request(method, params)
        .map(|request| (id, request))
        .map_err(|error| (Some(id), error))
}

fn request(method: &str, params: &Map<String, Value>) -> Result<Request, String> {
    match method {
        "open" => Ok(Request::Open {
            camera: name(params, "camera")?,
            preview: match params.get("preview") {
                None => PREVIEW.to_string(),
                Some(_) => name(params, "preview")?,
            },
        }),
        "close" => Ok(Request::Close),
        "photo" => Ok(Request::Photo {
            path: path(params, "path")?,
            poster: path(params, "poster")?,
        }),
        "record" => Ok(Request::Record {
            path: path(params, "path")?,
            poster: path(params, "poster")?,
            microphone: match params.get("microphone") {
                None => true,
                Some(value) => value
                    .as_bool()
                    .ok_or("`microphone` must be true or false")?,
            },
        }),
        "stop" => Ok(Request::Stop),
        "encoders" => Ok(Request::Encoders),
        other => Err(format!("unknown method {other:?}")),
    }
}

/// A PipeWire name or serial: printable, no quotes or spaces, at most 128 bytes.
fn name(params: &Map<String, Value>, key: &str) -> Result<String, String> {
    let value = params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-:@/".contains(c))
        })
        .ok_or(format!(
            "`{key}` must be a PipeWire node name or serial (letters, digits, and . _ - : @ /)"
        ))?;
    Ok(value.to_string())
}

/// An absolute path with no NUL, at most 4096 bytes.
fn path(params: &Map<String, Value>, key: &str) -> Result<PathBuf, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| value.starts_with('/') && !value.contains('\0') && value.len() <= 4096)
        .map(PathBuf::from)
        .ok_or(format!("`{key}` must be an absolute path"))
}

/// The reply line for request `id`.
pub fn reply(id: u64, outcome: Result<Value, String>) -> Value {
    match outcome {
        Ok(result) => json!({ "id": id, "result": result }),
        Err(error) => json!({ "id": id, "error": error }),
    }
}

/// An unsolicited line: the camera failed, a recording broke.
pub fn event(name: &str, message: &str) -> Value {
    json!({ "event": name, "message": message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_checked() {
        assert_eq!(
            parse(
                r#"{"id":1,"method":"open","params":{"camera":"v4l2_input.pci-0000_c4_00.3-usb-0_1.0"}}"#
            ),
            Ok((
                1,
                Request::Open {
                    camera: "v4l2_input.pci-0000_c4_00.3-usb-0_1.0".into(),
                    preview: PREVIEW.into()
                }
            ))
        );
        assert_eq!(
            parse(
                r#"{"id":2,"method":"record","params":{"path":"/home/alexk/Videos/a.mp4","poster":"/tmp/p.jpg"}}"#
            ),
            Ok((
                2,
                Request::Record {
                    path: "/home/alexk/Videos/a.mp4".into(),
                    poster: "/tmp/p.jpg".into(),
                    microphone: true
                }
            ))
        );
        assert_eq!(parse(r#"{"id":3,"method":"stop"}"#), Ok((3, Request::Stop)));
    }

    #[test]
    fn bad_lines_say_why_and_keep_the_id() {
        assert_eq!(parse("nope"), Err((None, "not JSON".into())));
        assert_eq!(parse(r#"{"method":"stop"}"#), Err((None, "no id".into())));
        assert!(matches!(
            parse(r#"{"id":4,"method":"format-disk"}"#),
            Err((Some(4), _))
        ));
        for bad in [
            r#"{"id":5,"method":"photo","params":{"path":"relative.jpg","poster":"/p.jpg"}}"#,
            r#"{"id":5,"method":"photo","params":{"path":"/a.jpg"}}"#,
            r#"{"id":5,"method":"open","params":{"camera":"a b"}}"#,
            r#"{"id":5,"method":"open","params":{"camera":"x\"y"}}"#,
            r#"{"id":5,"method":"record","params":{"path":"/a.mp4","poster":"/p.jpg","microphone":"yes"}}"#,
            r#"{"id":5,"method":"open","params":4}"#,
        ] {
            assert!(matches!(parse(bad), Err((Some(5), _))), "{bad}");
        }
    }

    #[test]
    fn replies_carry_the_id() {
        assert_eq!(
            reply(7, Ok(json!({"width": 2}))),
            json!({"id": 7, "result": {"width": 2}})
        );
        assert_eq!(reply(8, Err("no".into())), json!({"id": 8, "error": "no"}));
    }
}
