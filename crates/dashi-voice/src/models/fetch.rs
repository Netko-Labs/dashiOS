//! Fetching models: `curl` (run as a program) brings every missing file,
//! four at a time, going on from the part a stopped fetch left; each is
//! checked against its size and SHA-256 before it gets its name. Run by `dashi-voice fetch`, a process of
//! its own: the service that hears the microphone has no network
//! (docs/voice.md, "The models").

use std::path::{Path, PathBuf};
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

/// One file of a fetch: where it comes from, and where its part and its whole go.
struct Wanted {
    set: &'static Set,
    file: &'static File,
    part: PathBuf,
    path: PathBuf,
}

impl Wanted {
    /// Bytes of it here so far.
    fn have(&self) -> u64 {
        let size = |path: &Path| std::fs::metadata(path).map_or(0, |found| found.len());
        size(&self.part).max(size(&self.path)).min(self.file.bytes)
    }
}

/// One curl for every file: connections are kept, four files come at a time,
/// and each goes on from the part a stopped fetch left.
fn curl(wanted: &[&Wanted]) -> Result<Child, String> {
    let mut command = Command::new("curl");
    command
        .args([
            "--fail",
            "--fail-early",
            "--location",
            "--silent",
            "--show-error",
        ])
        .args(["--retry", "3", "--connect-timeout", "20"])
        .args(["--parallel", "--parallel-max", "4"]);
    for each in wanted {
        command
            .args(["--continue-at", "-", "--output"])
            .arg(&each.part)
            .arg(each.file.url);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "curl is not installed".to_owned())
}

/// What curl said went wrong, as a person would say it.
fn curl_words(code: Option<i32>) -> String {
    match code {
        Some(6 | 7 | 28 | 35 | 52 | 56) => {
            "The models could not be fetched: this computer is offline, or the server did not answer.".into()
        }
        Some(22) => "The models could not be fetched: the server refused.".into(),
        Some(23) => {
            "The models could not be saved: the disk is full, or the folder can't be written.".into()
        }
        _ => "The models could not be fetched.".into(),
    }
}

/// Bring these files down to their parts, telling `tick` as they grow. False when cancelled.
fn download(wanted: &[&Wanted], tick: &mut dyn FnMut() -> bool) -> Result<bool, String> {
    for each in wanted {
        if let Some(folder) = each.part.parent() {
            std::fs::create_dir_all(folder)
                .map_err(|error| format!("{}: {error}", folder.display()))?;
        }
        // A part longer than the file is not a part of it.
        if std::fs::metadata(&each.part).is_ok_and(|found| found.len() > each.file.bytes) {
            let _ = std::fs::remove_file(&each.part);
        }
    }
    // A part that is already whole needs no fetching (and curl would be refused the rest of nothing).
    let coming: Vec<&Wanted> = wanted
        .iter()
        .copied()
        .filter(|each| each.have() < each.file.bytes)
        .collect();
    if coming.is_empty() {
        return Ok(true);
    }
    let mut child = curl(&coming)?;
    loop {
        if !tick() {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(false);
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(true),
            Ok(Some(status)) => return Err(curl_words(status.code())),
            Ok(None) => std::thread::sleep(TICK),
            Err(error) => return Err(format!("curl: {error}")),
        }
    }
}

/// Give each part that is whole and has the right hash its name; the ones that were wrong, their parts deleted.
fn keep<'a>(wanted: &[&'a Wanted]) -> Result<Vec<&'a Wanted>, String> {
    let mut wrong = Vec::new();
    for each in wanted {
        let whole = std::fs::metadata(&each.part).is_ok_and(|found| found.len() == each.file.bytes);
        if whole && sha256(&each.part)? == each.file.sha256 {
            std::fs::rename(&each.part, &each.path)
                .map_err(|error| format!("{}: {error}", each.path.display()))?;
        } else {
            let _ = std::fs::remove_file(&each.part);
            wrong.push(*each);
        }
    }
    Ok(wrong)
}

/// Fetch what is missing of these sets. `report` hears the progress and
/// answers whether to go on; false stops the fetch, keeping what came.
pub(crate) fn fetch(
    store: &Store,
    sets: &[&'static Set],
    report: &mut dyn FnMut(Progress) -> bool,
) -> Result<bool, String> {
    let bytes: u64 = sets.iter().map(|set| set.bytes()).sum();
    let wanted: Vec<Wanted> = sets
        .iter()
        .flat_map(|set| store.missing(set).into_iter().map(move |file| (*set, file)))
        .map(|(set, file)| Wanted {
            set,
            file,
            part: store.partial(set, file),
            path: store.path(set, file),
        })
        .collect();
    let missing: u64 = wanted.iter().map(|each| each.file.bytes).sum();
    let needed = missing - wanted.iter().map(Wanted::have).sum::<u64>();
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
    let mut left: Vec<&Wanted> = wanted.iter().collect();
    // A part kept from a stopped fetch may be stale: what has the wrong hash is fetched once more from nothing.
    for _ in 0..2 {
        if left.is_empty() {
            break;
        }
        let mut tick = || {
            // The first file still coming names the progress.
            let coming = wanted
                .iter()
                .find(|each| each.have() < each.file.bytes)
                .unwrap_or(&wanted[0]);
            let received = bytes - missing + wanted.iter().map(Wanted::have).sum::<u64>();
            report(Progress {
                set: coming.set.id,
                file: coming.file.path,
                received,
                bytes,
            })
        };
        if !download(&left, &mut tick)? {
            return Ok(false);
        }
        left = keep(&left)?;
    }
    match left.first() {
        None => Ok(true),
        Some(each) => Err(format!(
            "{} did not arrive whole; nothing was kept of it.",
            each.file.path
        )),
    }
}

#[cfg(test)]
#[path = "fetch_tests.rs"]
mod tests;
