//! Where things are: the socket in the session's runtime folder, the models
//! in the person's data folder. Nothing else is kept anywhere.

use std::path::PathBuf;

fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

/// `$DASHI_VOICE_SOCKET`, else `$XDG_RUNTIME_DIR/dashi-voice.sock`.
pub(crate) fn socket() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("DASHI_VOICE_SOCKET") {
        return Ok(PathBuf::from(path));
    }
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(|dir| PathBuf::from(dir).join("dashi-voice.sock"))
        .ok_or_else(|| "there is no session to serve (XDG_RUNTIME_DIR is not set)".to_owned())
}

/// `$DASHI_VOICE_MODELS`, else `$XDG_DATA_HOME/dashi/voice`, else `~/.local/share/dashi/voice`.
pub(crate) fn models() -> PathBuf {
    if let Some(path) = std::env::var_os("DASHI_VOICE_MODELS") {
        return PathBuf::from(path);
    }
    std::env::var_os("XDG_DATA_HOME")
        .filter(|dir| !dir.is_empty())
        .map_or_else(|| home().join(".local/share"), PathBuf::from)
        .join("dashi/voice")
}
