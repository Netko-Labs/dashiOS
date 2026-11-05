//! A client of dashi-secretd's socket, for the PAM helper and the bridge: one
//! request line out, one reply line back. Lines that may hold secrets live in
//! memory that is zeroed afterwards.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::Path,
    time::Duration,
};

use serde_json::Value;
use zeroize::Zeroizing;

pub struct Client {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
}

impl Client {
    pub fn connect(path: &Path) -> Result<Self, String> {
        let stream =
            UnixStream::connect(path).map_err(|e| format!("dashi-secretd is not running ({e})"))?;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
        let reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
        Ok(Self { stream, reader })
    }

    /// Send `request` (a JSON object, already serialized), and the reply's fields when it is ok.
    pub fn call_line(&mut self, request: &str) -> Result<Value, String> {
        let mut line = Zeroizing::new(String::with_capacity(request.len() + 1));
        line.push_str(request);
        line.push('\n');
        self.stream
            .write_all(line.as_bytes())
            .map_err(|e| format!("dashi-secretd: {e}"))?;
        let mut answer = Zeroizing::new(String::new());
        self.reader
            .read_line(&mut answer)
            .map_err(|e| format!("dashi-secretd: {e}"))?;
        let value: Value = serde_json::from_str(&answer)
            .map_err(|_| "dashi-secretd answered nonsense".to_string())?;
        if value.get("ok") == Some(&Value::Bool(true)) {
            Ok(value)
        } else {
            Err(value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("dashi-secretd refused")
                .to_string())
        }
    }

    pub fn call(&mut self, request: &Value) -> Result<Value, String> {
        let line = Zeroizing::new(request.to_string());
        self.call_line(&line)
    }
}
