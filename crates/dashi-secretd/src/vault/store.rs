//! Where vaults live: `<state>/<uid>.vault`, in dashi-secretd's own state
//! directory (/var/lib/dashi-secretd, mode 0700, owned by its user), written
//! whole to a new file and renamed into place, so a crash leaves the old one.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

pub struct Store {
    dir: PathBuf,
}

impl Store {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn path(&self, uid: u32) -> PathBuf {
        self.dir.join(format!("{uid}.vault"))
    }

    pub fn exists(&self, uid: u32) -> bool {
        self.path(uid).is_file()
    }

    pub fn read(&self, uid: u32) -> Result<Vec<u8>, String> {
        fs::read(self.path(uid)).map_err(|e| format!("reading the vault: {e}"))
    }

    pub fn write(&self, uid: u32, bytes: &[u8]) -> Result<(), String> {
        let path = self.path(uid);
        let temporary = self.dir.join(format!(".{uid}.vault.new"));
        write_new(&temporary, bytes)?;
        fs::rename(&temporary, &path).map_err(|e| format!("saving the vault: {e}"))?;
        if let Ok(dir) = fs::File::open(&self.dir) {
            let _ = dir.sync_all();
        }
        Ok(())
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _ = fs::remove_file(path);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| format!("saving the vault: {e}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("saving the vault: {e}"))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn vaults_are_private_and_replaced_whole() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path());
        assert!(!store.exists(1000));
        store.write(1000, b"one").unwrap();
        store.write(1000, b"two").unwrap();
        assert_eq!(store.read(1000).unwrap(), b"two");
        let mode = fs::metadata(store.path(1000)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
