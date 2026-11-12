//! ONNX Runtime, loaded from the system when a model is first needed
//! (Fedora's `onnxruntime` package, MIT). Nothing is linked at build time, so
//! the crate builds and its tests run on a machine without it.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use ort::environment::Environment;
use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;

/// Where the library is looked for, after `DASHI_VOICE_ONNXRUNTIME`.
const LIBRARY_DIRS: [&str; 4] = [
    "/usr/lib64",
    "/usr/lib",
    "/usr/local/lib64",
    "/usr/local/lib",
];

static ENVIRONMENT: OnceLock<Result<Environment, String>> = OnceLock::new();

/// The library's file: the override, else the newest `libonnxruntime.so*` of the system.
fn library() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("DASHI_VOICE_ONNXRUNTIME") {
        return Ok(PathBuf::from(path));
    }
    for dir in LIBRARY_DIRS {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        let mut found: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| is_runtime(path))
            .collect();
        found.sort();
        if let Some(path) = found.pop() {
            return Ok(path);
        }
    }
    Err("ONNX Runtime is not installed (the onnxruntime package)".into())
}

/// `libonnxruntime.so`, `libonnxruntime.so.1`, `libonnxruntime.so.1.22.2`; not the providers' library.
pub(crate) fn is_runtime(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix("libonnxruntime.so"))
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
}

fn environment() -> Result<&'static Environment, String> {
    ENVIRONMENT
        .get_or_init(|| {
            let path = library()?;
            let builder = ort::init_from(&path)
                .map_err(|error| format!("ONNX Runtime at {}: {error}", path.display()))?;
            builder
                .with_name("dashi-voice")
                .build()
                .map_err(|error| format!("ONNX Runtime would not start: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// How many threads a model runs on: half the cores (the other half are their
/// hyperthreads on most laptops), eight at most.
pub(crate) fn threads() -> usize {
    let cores = std::thread::available_parallelism().map_or(4, usize::from);
    (cores / 2).clamp(1, 8)
}

/// A model, ready to run.
pub(crate) fn session(model: &Path) -> Result<Session, String> {
    let fail = |error: ort::Error| format!("{}: {error}", model.display());
    let environment = environment()?;
    Session::builder(environment)
        .map_err(fail)?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|error| fail(error.into()))?
        .with_intra_threads(threads())
        .map_err(|error| fail(error.into()))?
        .commit_from_file(model)
        .map_err(fail)
}

/// A model's inputs, outputs and metadata, in words (`dashi-voice inspect`).
pub(crate) fn describe(model: &Path) -> Result<String, String> {
    let session = session(model)?;
    let mut lines = Vec::new();
    for input in session.inputs() {
        lines.push(format!("in  {} {:?}", input.name(), input.dtype()));
    }
    for output in session.outputs() {
        lines.push(format!("out {} {:?}", output.name(), output.dtype()));
    }
    if let Ok(metadata) = session.metadata() {
        for key in metadata.custom_keys().unwrap_or_default() {
            let value = metadata.custom(&key).unwrap_or_default();
            let short: String = value.chars().take(120).collect();
            lines.push(format!("meta {key} = {short}"));
        }
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_runtime_library_is_picked() {
        assert!(is_runtime(Path::new("/usr/lib64/libonnxruntime.so.1.22.2")));
        assert!(is_runtime(Path::new("/usr/lib64/libonnxruntime.so")));
        assert!(!is_runtime(Path::new(
            "/usr/lib64/libonnxruntime_providers_shared.so.1.22.2"
        )));
        assert!(!is_runtime(Path::new("/usr/lib64/libonnx.so.1.17.0")));
    }
}
