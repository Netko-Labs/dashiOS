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

fn user_name(uid: u32) -> Option<String> {
    // SAFETY: getpwuid returns a pointer to static storage or null; it is read at once.
    unsafe {
        let entry = libc::getpwuid(uid);
        if entry.is_null() {
            return None;
        }
        Some(
            CStr::from_ptr((*entry).pw_name)
                .to_string_lossy()
                .into_owned(),
        )
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
