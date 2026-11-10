//! A handle: 32 random characters from the kernel's randomness, read so that a
//! broken source never spins the event loop.

use std::io;

pub(super) const HANDLE_LENGTH: usize = 32;
pub(super) const ALPHABET: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/// A fresh handle from the kernel's randomness, or why there is none.
pub(super) fn new_handle() -> io::Result<String> {
    let mut bytes = [0u8; HANDLE_LENGTH];
    fill(&mut bytes, getrandom)?;
    Ok(bytes
        .iter()
        .map(|byte| ALPHABET[*byte as usize % ALPHABET.len()] as char)
        .collect())
}

/// Fills `bytes` from `read`: a short or interrupted read is retried; any
/// other failure, or a read of nothing, gives up, so a broken source never
/// spins the event loop.
fn fill(bytes: &mut [u8], mut read: impl FnMut(&mut [u8]) -> io::Result<usize>) -> io::Result<()> {
    let mut filled = 0;
    while filled < bytes.len() {
        match read(&mut bytes[filled..]) {
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(got) => filled += got,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn getrandom(buffer: &mut [u8]) -> io::Result<usize> {
    // SAFETY: `buffer` is a valid, writable buffer of `buffer.len()` bytes for the whole call.
    let got = unsafe { libc::getrandom(buffer.as_mut_ptr().cast(), buffer.len(), 0) };
    usize::try_from(got).map_err(|_| io::Error::last_os_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_source_gives_up_instead_of_spinning() {
        let mut bytes = [0u8; 8];
        let mut calls = 0;
        let result = fill(&mut bytes, |_| {
            calls += 1;
            Err(io::Error::from_raw_os_error(libc::ENOSYS))
        });
        assert_eq!(result.unwrap_err().raw_os_error(), Some(libc::ENOSYS));
        assert_eq!(calls, 1);
        assert!(fill(&mut bytes, |_| Ok(0)).is_err());
    }

    #[test]
    fn short_and_interrupted_reads_are_retried() {
        let mut bytes = [0u8; 8];
        let mut calls = 0;
        fill(&mut bytes, |rest| {
            calls += 1;
            if calls == 1 {
                return Err(io::ErrorKind::Interrupted.into());
            }
            rest[0] = 7;
            Ok(1)
        })
        .unwrap();
        assert_eq!(bytes, [7; 8]);
        assert_eq!(calls, 9);
    }

    #[test]
    fn handles_are_long_and_from_the_alphabet() {
        let handle = new_handle().unwrap();
        assert_eq!(handle.len(), HANDLE_LENGTH);
        assert!(handle.bytes().all(|b| ALPHABET.contains(&b)));
    }
}
