//! A CTAP2 (CBOR) request: answered off the read loop, with keep-alives while the person is asked.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use serde_json::json;

use super::{
    approval::Approvals,
    ctap2::{self, Ask, Env},
    ctaphid, fprint,
    run::reply,
    uhid::Device,
};
use crate::daemon::{Daemon, now};

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
pub(super) fn cbor(
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
