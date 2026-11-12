//! Fetching models: one file at a time with `curl` (run as a program; it
//! resumes a file a stopped fetch left), each checked against its size and
//! SHA-256 before it gets its name. Run by `dashi-voice fetch`, a process of
//! its own: the service that hears the microphone has no network
//! (docs/voice.md, "The models").

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use super::manifest::{File, Set};
use super::store::{Store, sha256};

/// How often the size on disk is read while a file comes.
const TICK: Duration = Duration::from_millis(200);

/// How far a fetch has come, over every file it was asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Progress {
    pub(crate) set: &'static str,
    pub(crate) file: &'static str,
    /// Bytes here so far, of `bytes` in all.
    pub(crate) received: u64,
    pub(crate) bytes: u64,
}

/// Free bytes on the disk that holds `folder`.
fn free_bytes(folder: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(folder.as_os_str().as_bytes()).ok()?;
    // SAFETY: an all-zero statvfs is a valid value for the kernel to fill in.
    let mut stats: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is a NUL-terminated string and `stats` is valid for writes.
    let result = unsafe { libc::statvfs(path.as_ptr(), &mut stats) };
    (result == 0).then(|| stats.f_bavail * stats.f_frsize)
}

/// Megabytes, as a person reads them.
pub(crate) fn megabytes(bytes: u64) -> String {
    format!("{} MB", bytes.div_ceil(1_000_000))
}

fn curl(url: &str, to: &Path) -> Result<Child, String> {
    Command::new("curl")
        .args(["--fail", "--location", "--silent", "--show-error"])
        .args([
            "--retry",
            "3",
            "--connect-timeout",
            "20",
            "--continue-at",
            "-",
        ])
        .arg("--output")
        .arg(to)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "curl is not installed".to_owned())
}

/// What curl said went wrong, as a person would say it.
fn curl_words(code: Option<i32>, name: &str) -> String {
    match code {
        Some(6 | 7 | 28 | 35 | 52 | 56) => format!(
            "{name} could not be fetched: this computer is offline, or the server did not answer"
        ),
        Some(22) => format!("{name} could not be fetched: the server refused"),
        Some(23) => {
            format!("{name} could not be saved: the disk is full, or the folder can't be written")
        }
        _ => format!("{name} could not be fetched"),
    }
}

/// Bring one file down to its `.part`, telling `tick` its size as it grows. False when cancelled.
fn download(file: &File, part: &Path, tick: &mut dyn FnMut(u64) -> bool) -> Result<bool, String> {
    let have = std::fs::metadata(part).map_or(0, |found| found.len());
    if have > file.bytes {
        let _ = std::fs::remove_file(part);
    } else if have == file.bytes {
        return Ok(true);
    }
    let mut child = curl(file.url, part)?;
    loop {
        let size = std::fs::metadata(part).map_or(0, |found| found.len());
        if !tick(size) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(false);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(true),
            Ok(Some(status)) => {
                // 33: the server would not resume; start the file again next time.
                if status.code() == Some(33) {
                    let _ = std::fs::remove_file(part);
                }
                return Err(curl_words(status.code(), file.path));
            }
            Ok(None) => std::thread::sleep(TICK),
            Err(error) => return Err(format!("{}: {error}", file.path)),
        }
    }
}

/// One file, whole and checked, under its name. False when cancelled.
fn fetch_file(
    store: &Store,
    set: &Set,
    file: &File,
    tick: &mut dyn FnMut(u64) -> bool,
) -> Result<bool, String> {
    let (path, part) = (store.path(set, file), store.partial(set, file));
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|error| format!("{}: {error}", folder.display()))?;
    }
    // A part kept from a stopped fetch may be stale: if its hash is wrong, fetch it once more from nothing.
    for attempt in 0..2 {
        if !download(file, &part, tick)? {
            return Ok(false);
        }
        let size = std::fs::metadata(&part).map_or(0, |found| found.len());
        if size == file.bytes && sha256(&part)? == file.sha256 {
            std::fs::rename(&part, &path)
                .map_err(|error| format!("{}: {error}", path.display()))?;
            return Ok(true);
        }
        let _ = std::fs::remove_file(&part);
        if attempt == 1 {
            break;
        }
    }
    Err(format!(
        "{} did not arrive whole; nothing was kept of it",
        file.path
    ))
}

/// Fetch what is missing of these sets. `report` hears the progress and
/// answers whether to go on; false stops the fetch, keeping what came.
pub(crate) fn fetch(
    store: &Store,
    sets: &[&'static Set],
    report: &mut dyn FnMut(Progress) -> bool,
) -> Result<bool, String> {
    let bytes: u64 = sets.iter().map(|set| set.bytes()).sum();
    let mut done: u64 = sets
        .iter()
        .map(|set| {
            set.bytes()
                - store
                    .missing(set)
                    .iter()
                    .map(|file| file.bytes)
                    .sum::<u64>()
        })
        .sum();
    let needed = bytes - sets.iter().map(|set| store.have(set)).sum::<u64>();
    std::fs::create_dir_all(store.folder())
        .map_err(|error| format!("{}: {error}", store.folder().display()))?;
    if let Some(free) = free_bytes(store.folder())
        && free < needed
    {
        return Err(format!(
            "There is not enough room: the models need {}, and {} is free.",
            megabytes(needed),
            megabytes(free)
        ));
    }
    for set in sets {
        for file in store.missing(set) {
            let mut tick = |size: u64| {
                report(Progress {
                    set: set.id,
                    file: file.path,
                    received: done + size.min(file.bytes),
                    bytes,
                })
            };
            if !fetch_file(store, set, file, &mut tick)? {
                return Ok(false);
            }
            done += file.bytes;
        }
    }
    Ok(true)
}

#[cfg(test)]
#[path = "fetch_tests.rs"]
mod tests;
