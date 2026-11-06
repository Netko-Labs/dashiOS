//! Passkeys as a security key (docs/secrets.md, "Passkeys"): dashi-secretd
//! makes a virtual FIDO2 key over uhid; browsers talk CTAPHID (ctaphid.rs)
//! and CTAP2 (ctap2.rs) to it; the keys live in the vault of the person at
//! the screen (store.rs); every use is asked about and needs the fingerprint
//! or the password (approval.rs, fprint.rs).

pub mod approval;
pub mod ctap2;
pub mod ctaphid;
pub mod fprint;
pub mod store;
pub mod uhid;

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::json;

use crate::daemon::{Daemon, now};
use approval::Approvals;
use ctap2::{Ask, Env};
use ctaphid::{Assembler, BROADCAST, Message};
use uhid::Device;

pub const UHID: &str = "/dev/uhid";

fn reply(device: &Device, cid: u32, cmd: u8, data: &[u8]) {
    for packet in ctaphid::frame(cid, cmd, data) {
        device.send(&packet);
    }
}

fn what(ask: &Ask) -> serde_json::Value {
    match ask {
        Ask::Register { rp_id, user } => {
            json!({ "kind": "passkey-register", "rp": rp_id, "user": user })
        }
        Ask::SignIn { rp_id, user } => {
            json!({ "kind": "passkey-sign-in", "rp": rp_id, "user": user })
        }
    }
}

/// One CBOR request, answered from a thread of its own, with keep-alives while the person is asked.
fn cbor(
    device: Device,
    cid: u32,
    data: Vec<u8>,
    daemon: Arc<Mutex<Daemon>>,
    approvals: Arc<Approvals>,
) {
    thread::spawn(move || {
        let done = Arc::new(AtomicBool::new(false));
        let keepalive = {
            let (device, done) = (device.clone(), done.clone());
            thread::spawn(move || {
                while !done.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(100));
                    if !done.load(Ordering::SeqCst) {
                        reply(
                            &device,
                            cid,
                            ctaphid::KEEPALIVE,
                            &[ctaphid::STATUS_UPNEEDED],
                        );
                    }
                }
            })
        };
        // The person at the screen: the one whose shell is watching for questions.
        let uid = approvals.watching();
        let with = |f: &mut dyn FnMut(&mut crate::vault::Data)| {
            uid.is_some_and(|uid| daemon.lock().is_ok_and(|mut d| d.with_data(uid, f)))
        };
        let approve = |ask: &Ask| {
            let Some(uid) = uid else { return false };
            let finger = approvals.clone();
            approvals.ask(uid, what(ask), move |id| {
                if fprint::verify(uid) {
                    finger.answer(uid, id, true);
                }
            })
        };
        let answer = ctap2::handle(
            &data,
            &Env {
                with: &with,
                approve: &approve,
                now: now(),
            },
        );
        done.store(true, Ordering::SeqCst);
        let _ = keepalive.join();
        reply(&device, cid, ctaphid::CBOR, &answer);
    });
}

fn dispatch(
    device: &Device,
    message: Message,
    next_cid: &mut u32,
    daemon: &Arc<Mutex<Daemon>>,
    approvals: &Arc<Approvals>,
) {
    let Message { cid, cmd, data } = message;
    match cmd {
        ctaphid::INIT => {
            let channel = if cid == BROADCAST {
                *next_cid = next_cid.wrapping_add(1).max(1);
                *next_cid
            } else {
                cid
            };
            reply(
                device,
                cid,
                ctaphid::INIT,
                &ctaphid::init_reply(&data, channel),
            );
        }
        _ if cid == BROADCAST => {
            reply(device, cid, ctaphid::ERROR, &[ctaphid::ERR_INVALID_CHANNEL])
        }
        ctaphid::PING => reply(device, cid, ctaphid::PING, &data),
        ctaphid::WINK => reply(device, cid, ctaphid::WINK, &[]),
        // The question already up stays up until answered or timed out.
        ctaphid::CANCEL => {}
        ctaphid::CBOR => cbor(device.clone(), cid, data, daemon.clone(), approvals.clone()),
        _ => reply(device, cid, ctaphid::ERROR, &[ctaphid::ERR_INVALID_CMD]),
    }
}

/// Make the key and answer it until the device goes away.
pub fn serve(daemon: Arc<Mutex<Daemon>>, approvals: Arc<Approvals>) -> Result<(), String> {
    let device = Device::create(UHID)?;
    let mut assembler = Assembler::default();
    let mut next_cid = 0u32;
    while let Some(event) = device.next() {
        let Some(report) = uhid::output_report(&event) else {
            continue;
        };
        match assembler.push(&report) {
            Ok(Some(message)) => dispatch(&device, message, &mut next_cid, &daemon, &approvals),
            Ok(None) => {}
            Err(error) => reply(&device, error.cid, ctaphid::ERROR, &[error.code]),
        }
    }
    Ok(())
}
