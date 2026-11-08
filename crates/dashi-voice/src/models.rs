//! Where the models are, and ONNX Runtime.
//!
//! The shell downloads them (src/voice/models/, pinned URLs and sha256) into
//! the models folder, `$XDG_DATA_HOME/dashi/voice/models`, in this layout;
//! this service only reads them. ONNX Runtime is the system's
//! (`libonnxruntime.so.1`, Fedora's onnxruntime), loaded at run time.

use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};

use ort::{
    environment::Environment,
    session::{Session, builder::GraphOptimizationLevel},
};

pub(crate) const PARAKEET: &str = "parakeet-tdt-0.6b-v3";
pub(crate) const SILERO: &str = "silero-vad";
pub(crate) const KOKORO: &str = "kokoro-82m";

pub(crate) struct Paths {
    pub root: PathBuf,
}

impl Paths {
    /// `--models DIR`, else `$DASHI_VOICE_MODELS`, else the data folder's.
    pub(crate) fn find(explicit: Option<PathBuf>) -> Self {
        let root = explicit
            .or_else(|| std::env::var_os("DASHI_VOICE_MODELS").map(PathBuf::from))
            .unwrap_or_else(|| {
                let data = std::env::var_os("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .or_else(|| {
                        std::env::var_os("HOME")
                            .map(|home| PathBuf::from(home).join(".local/share"))
                    })
                    .unwrap_or_else(|| PathBuf::from("/nonexistent"));
                data.join("dashi/voice/models")
            });
        Self { root }
    }

    pub(crate) fn parakeet(&self, file: &str) -> PathBuf {
        self.root.join(PARAKEET).join(file)
    }

    pub(crate) fn silero(&self) -> PathBuf {
        self.root.join(SILERO).join("silero_vad.onnx")
    }

    pub(crate) fn kokoro(&self, file: &str) -> PathBuf {
        self.root.join(KOKORO).join(file)
    }

    pub(crate) fn voice(&self, name: &str) -> Option<PathBuf> {
        // A voice is a plain name ("af_heart"): never a path.
        let plain = !name.is_empty()
            && name.len() <= 32
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        plain.then(|| {
            self.root
                .join(KOKORO)
                .join("voices")
                .join(format!("{name}.bin"))
        })
    }

    /// Everything listening needs is there.
    pub(crate) fn can_listen(&self) -> bool {
        self.silero().is_file()
            && [
                "nemo128.onnx",
                "encoder-model.int8.onnx",
                "decoder_joint-model.int8.onnx",
                "vocab.txt",
            ]
            .iter()
            .all(|file| self.parakeet(file).is_file())
    }

    /// Everything speaking needs is there (a voice is checked when used).
    pub(crate) fn can_speak(&self) -> bool {
        self.kokoro("model.onnx").is_file() && self.kokoro("tokenizer.json").is_file()
    }
}

static ENVIRONMENT: OnceLock<Result<Environment, String>> = OnceLock::new();

/// ONNX Runtime, loaded once: `$DASHI_ONNXRUNTIME`, else the system's.
pub(crate) fn environment() -> Result<&'static Environment, String> {
    ENVIRONMENT
        .get_or_init(|| {
            let library = std::env::var_os("DASHI_ONNXRUNTIME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("libonnxruntime.so.1"));
            ort::init_from(&library)
                .map_err(|error| {
                    format!(
                        "ONNX Runtime isn't installed ({}): {error}",
                        library.display()
                    )
                })?
                .with_name("dashi-voice")
                .with_telemetry(false)
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// A model, on `threads` threads.
pub(crate) fn session(path: &Path, threads: usize) -> Result<Session, String> {
    let environment = environment()?;
    let fail = |error: ort::Error| format!("{}: {error}", path.display());
    Session::builder(environment)
        .map_err(fail)?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|error| fail(error.into()))?
        .with_intra_threads(threads)
        .map_err(|error| fail(error.into()))?
        .commit_from_file(path)
        .map_err(fail)
}

/// Threads for the big models: the machine's cores, leaving one for the desktop.
pub(crate) fn threads() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get().saturating_sub(1).clamp(1, 8))
        .unwrap_or(2)
}
