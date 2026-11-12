//! The models on disk: `<folder>/<set>/<file>`. A set is installed when
//! every file of it is there at its full size; the fetch checked each one's
//! SHA-256 before giving it its name, and `verify` checks them again.

use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::manifest::{self, File, Set};

#[derive(Clone)]
pub(crate) struct Store {
    folder: PathBuf,
}

impl Store {
    pub(crate) fn new(folder: impl Into<PathBuf>) -> Self {
        Self {
            folder: folder.into(),
        }
    }

    pub(crate) fn folder(&self) -> &Path {
        &self.folder
    }

    pub(crate) fn set_folder(&self, set: &str) -> PathBuf {
        self.folder.join(set)
    }

    pub(crate) fn path(&self, set: &Set, file: &File) -> PathBuf {
        self.set_folder(set.id).join(file.path)
    }

    /// A file being fetched: it gets its real name only once its hash is right.
    pub(crate) fn partial(&self, set: &Set, file: &File) -> PathBuf {
        let mut name = self.path(set, file).into_os_string();
        name.push(".part");
        PathBuf::from(name)
    }

    fn has(&self, set: &Set, file: &File) -> bool {
        std::fs::metadata(self.path(set, file)).is_ok_and(|found| found.len() == file.bytes)
    }

    pub(crate) fn installed(&self, set: &Set) -> bool {
        set.files.iter().all(|file| self.has(set, file))
    }

    pub(crate) fn installed_id(&self, id: &str) -> bool {
        manifest::set(id).is_some_and(|set| self.installed(set))
    }

    /// Bytes of the set already here: whole files, and the part of one a fetch left.
    pub(crate) fn have(&self, set: &Set) -> u64 {
        set.files
            .iter()
            .map(|file| {
                if self.has(set, file) {
                    return file.bytes;
                }
                std::fs::metadata(self.partial(set, file))
                    .map_or(0, |part| part.len().min(file.bytes))
            })
            .sum()
    }

    /// The files of a set still to fetch.
    pub(crate) fn missing<'a>(&self, set: &'a Set) -> Vec<&'a File> {
        set.files
            .iter()
            .filter(|file| !self.has(set, file))
            .collect()
    }

    /// Delete a set, and what a fetch left of it.
    pub(crate) fn remove(&self, set: &Set) -> Result<(), String> {
        match std::fs::remove_dir_all(self.set_folder(set.id)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("{} could not be removed: {error}", set.name)),
        }
    }

    /// Every installed file of a set against its hash; the first that is wrong, in words.
    pub(crate) fn verify(&self, set: &Set) -> Result<(), String> {
        for file in set.files {
            let path = self.path(set, file);
            if sha256(&path)? != file.sha256 {
                return Err(format!("{} is damaged; fetch it again", path.display()));
            }
        }
        Ok(())
    }
}

/// A file's SHA-256, in lower-case hex.
pub(crate) fn sha256(path: &Path) -> Result<String, String> {
    let fail = |error: std::io::Error| format!("{}: {error}", path.display());
    let mut file = std::fs::File::open(path).map_err(fail)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(fail)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SET: Set = Set {
        id: "test",
        name: "Test",
        about: "",
        credit: "",
        basic: true,
        files: &[
            File {
                path: "a.bin",
                url: "",
                bytes: 3,
                sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            },
            File {
                path: "deep/b.bin",
                url: "",
                bytes: 5,
                sha256: "",
            },
        ],
    };

    #[test]
    fn a_set_is_installed_when_every_file_is_whole() {
        let folder = tempfile::tempdir().unwrap();
        let store = Store::new(folder.path());
        assert!(!store.installed(&SET));
        assert_eq!(store.have(&SET), 0);
        assert_eq!(store.missing(&SET).len(), 2);
        std::fs::create_dir_all(folder.path().join("test/deep")).unwrap();
        std::fs::write(folder.path().join("test/a.bin"), "abc").unwrap();
        // A fetch that stopped part way counts for what it has, and installs nothing.
        std::fs::write(folder.path().join("test/deep/b.bin.part"), "12").unwrap();
        assert_eq!(store.have(&SET), 5);
        assert!(!store.installed(&SET));
        assert_eq!(store.missing(&SET)[0].path, "deep/b.bin");
        // A file of the wrong size is not installed either.
        std::fs::write(folder.path().join("test/deep/b.bin"), "1234").unwrap();
        assert!(!store.installed(&SET));
        std::fs::write(folder.path().join("test/deep/b.bin"), "12345").unwrap();
        assert!(store.installed(&SET));
        assert_eq!(store.have(&SET), 8);
    }

    #[test]
    fn hashes_are_checked_and_sets_removed() {
        let folder = tempfile::tempdir().unwrap();
        let store = Store::new(folder.path());
        std::fs::create_dir_all(folder.path().join("test")).unwrap();
        std::fs::write(folder.path().join("test/a.bin"), "abc").unwrap();
        assert_eq!(
            sha256(&folder.path().join("test/a.bin")).unwrap(),
            SET.files[0].sha256
        );
        std::fs::write(folder.path().join("test/a.bin"), "abd").unwrap();
        assert!(store.verify(&SET).unwrap_err().contains("damaged"));
        store.remove(&SET).unwrap();
        assert!(!folder.path().join("test").exists());
        // Removing what is not there is not an error.
        store.remove(&SET).unwrap();
    }
}
