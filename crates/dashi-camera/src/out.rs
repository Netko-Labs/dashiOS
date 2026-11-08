//! stdout, shared by the main loop's replies and the bus threads' events:
//! one JSON object per line, whole lines only.

use std::{
    io::Write,
    sync::{Arc, Mutex},
};

use serde_json::Value;

#[derive(Clone, Default)]
pub struct Out(Arc<Mutex<()>>);

impl Out {
    pub fn send(&self, value: &Value) {
        let Ok(_held) = self.0.lock() else { return };
        let mut stdout = std::io::stdout().lock();
        // The shell gone: nothing to tell; the loop ends at stdin's end.
        let _ = writeln!(stdout, "{value}");
        let _ = stdout.flush();
    }

    pub fn event(&self, name: &str, message: &str) {
        self.send(&crate::protocol::event(name, message));
    }
}
