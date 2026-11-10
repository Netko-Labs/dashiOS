//! What can go wrong with one request.

/// The outcome of one request (the CLI prints it; the service maps it to a
/// D-Bus reply or error).
#[derive(Debug)]
pub(crate) enum OpError {
    /// No such knob or fan on this machine.
    NotFound(String),
    /// The value was the wrong type or outside what the knob takes.
    Invalid(String),
    /// A write failed.
    Io(String),
    /// The Curve Optimizer isn't available (the reason string).
    Unavailable(String),
    /// A device the model names isn't there (the Slash bar).
    NoDevice(String),
}

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpError::NotFound(s) => write!(f, "{s} is not on this machine"),
            OpError::Invalid(s) => write!(f, "{s}"),
            OpError::Io(s) => write!(f, "{s}"),
            OpError::Unavailable(s) => write!(f, "the Curve Optimizer is unavailable: {s}"),
            OpError::NoDevice(s) => write!(f, "{s}"),
        }
    }
}
