//! The fingerprint reader, asked by dashi-secretd itself (fprintd on the
//! system bus), so a "yes" by fingerprint is the vault's own finding, not
//! something a program running as the person claims. Its polkit rule
//! (50-dashi-secretd.rules) lets the dashi-secret user verify a person's
//! finger; enrolling stays the person's own business. No reader, no finger
//! enrolled, or no match: the password is the way.

use std::ffi::CStr;

use zbus::{blocking::Connection, blocking::Proxy, zvariant::OwnedObjectPath};

const SERVICE: &str = "net.reactivated.Fprint";
/// Scans before giving up on the finger.
const TRIES: usize = 3;

/// `uid`'s login name. getpwuid_r, with a buffer of our own: verify runs on
/// several threads at once, and getpwuid's static storage isn't safe there.
fn user_name(uid: u32) -> Option<String> {
    let mut size = 1024;
    loop {
        let mut buffer = vec![0 as libc::c_char; size];
        // SAFETY: an all-zero passwd is valid (null pointers, zero ids); it is only written by getpwuid_r.
        let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
        let mut found: *mut libc::passwd = std::ptr::null_mut();
        // SAFETY: every pointer is to storage we own for the call, `size` is the buffer's length.
        let error =
            unsafe { libc::getpwuid_r(uid, &mut entry, buffer.as_mut_ptr(), size, &mut found) };
        if error == libc::ERANGE && size < 1 << 20 {
            size *= 2;
            continue;
        }
        if error != 0 || found.is_null() || entry.pw_name.is_null() {
            return None;
        }
        // SAFETY: pw_name points into `buffer`, still alive, NUL-terminated by getpwuid_r.
        let name = unsafe { CStr::from_ptr(entry.pw_name) };
        return Some(name.to_string_lossy().into_owned());
    }
}

/// Whether `uid`'s finger is on the reader now (and matches). Blocks while the reader waits.
pub fn verify(uid: u32) -> bool {
    let Some(user) = user_name(uid) else {
        return false;
    };
    let run = || -> zbus::Result<bool> {
        let bus = Connection::system()?;
        let manager = Proxy::new(
            &bus,
            SERVICE,
            "/net/reactivated/Fprint/Manager",
            "net.reactivated.Fprint.Manager",
        )?;
        let path: OwnedObjectPath = manager.call("GetDefaultDevice", &())?;
        let device = Proxy::new(&bus, SERVICE, path, "net.reactivated.Fprint.Device")?;
        device.call::<_, _, ()>("Claim", &(user.as_str(),))?;
        let mut matched = false;
        let mut statuses = device.receive_signal("VerifyStatus")?;
        for _ in 0..TRIES {
            device.call::<_, _, ()>("VerifyStart", &("any",))?;
            for message in statuses.by_ref() {
                let (result, done): (String, bool) = message.body().deserialize()?;
                if result == "verify-match" {
                    matched = true;
                }
                if done {
                    break;
                }
            }
            let _ = device.call::<_, _, ()>("VerifyStop", &());
            if matched {
                break;
            }
        }
        let _ = device.call::<_, _, ()>("Release", &());
        Ok(matched)
    };
    run().unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_password_database_on_many_threads() {
        let threads: Vec<_> = (0..8)
            .map(|_| std::thread::spawn(|| (0..50).map(|_| user_name(0)).collect::<Vec<_>>()))
            .collect();
        for thread in threads {
            assert!(
                thread
                    .join()
                    .unwrap()
                    .iter()
                    .all(|n| n.as_deref() == Some("root"))
            );
        }
        assert_eq!(user_name(u32::MAX - 1), None);
    }
}
