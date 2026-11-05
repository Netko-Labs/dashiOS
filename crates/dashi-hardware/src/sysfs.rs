//! The tree the helper reads and writes: `/sys`, or a fake one (`--sysfs-root`).
//!
//! Every path the helper touches is built here from a fixed, relative path
//! under the root; nothing a caller sends becomes part of a path except a
//! name already found by listing a directory.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Where the kernel's files are: the real `/sys`, or a fake tree for tests.
#[derive(Clone, Debug)]
pub(crate) struct Sysfs {
    root: PathBuf,
    fake: bool,
}

impl Sysfs {
    pub(crate) fn real() -> Self {
        Self {
            root: PathBuf::from("/sys"),
            fake: false,
        }
    }

    pub(crate) fn fake(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            fake: true,
        }
    }

    /// Whether this is a fake tree (the SMU is simulated then).
    pub(crate) fn is_fake(&self) -> bool {
        self.fake
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// The absolute path of `rel` (a path relative to `/sys`).
    pub(crate) fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel.trim_start_matches('/'))
    }

    /// A file's contents, trimmed; `None` when it is missing or unreadable.
    pub(crate) fn read(&self, rel: &str) -> Option<String> {
        read_trimmed(&self.path(rel))
    }

    pub(crate) fn read_u64(&self, rel: &str) -> Option<u64> {
        self.read(rel)?.parse().ok()
    }

    pub(crate) fn exists(&self, rel: &str) -> bool {
        self.path(rel).exists()
    }

    /// Write `value` to an existing file (sysfs attributes are never created).
    pub(crate) fn write(&self, rel: &str, value: &str) -> io::Result<()> {
        write_existing(&self.path(rel), value)
    }

    /// The names in a directory, sorted; empty when it is missing.
    pub(crate) fn list(&self, rel: &str) -> Vec<String> {
        list_dir(&self.path(rel))
    }
}

pub(crate) fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|text| text.trim().to_owned())
}

pub(crate) fn write_existing(path: &Path, value: &str) -> io::Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).truncate(true).open(path)?;
    file.write_all(value.as_bytes())
}

pub(crate) fn list_dir(path: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(path) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

#[cfg(test)]
pub(crate) mod testing {
    //! A writable copy of a fixture tree, removed when dropped.

    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU32, Ordering};

    pub(crate) struct TempTree {
        pub(crate) path: PathBuf,
    }

    impl TempTree {
        pub(crate) fn empty() -> Self {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "dashi-hardware-test-{}-{n}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("test: the temporary directory can be made");
            Self { path }
        }

        /// A copy of `data/fixtures/<name>`.
        pub(crate) fn fixture(name: &str) -> Self {
            let tree = Self::empty();
            let source = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../data/fixtures")
                .join(name);
            copy_dir(&source, &tree.path);
            tree
        }

        pub(crate) fn file(&self, rel: &str, contents: &str) {
            let path = self.path.join(rel);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).expect("test: a fixture directory can be made");
            }
            fs::write(path, format!("{contents}\n")).expect("test: a fixture file can be written");
        }

        pub(crate) fn read(&self, rel: &str) -> String {
            fs::read_to_string(self.path.join(rel))
                .unwrap_or_default()
                .trim()
                .to_owned()
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).expect("test: a directory can be made");
        for entry in fs::read_dir(from).expect("test: the fixture exists").flatten() {
            let target = to.join(entry.file_name());
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                copy_dir(&entry.path(), &target);
            } else {
                fs::copy(entry.path(), target).expect("test: a fixture file can be copied");
            }
        }
    }
}
