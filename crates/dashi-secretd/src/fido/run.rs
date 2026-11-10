//! The virtual key's read loop: CTAPHID messages in, answers out, until the device goes away.

use std::sync::{Arc, Mutex};

use super::{
    approval::Approvals,
    ctaphid::{self, Assembler, BROADCAST, Message},
    request::cbor,
    uhid::{self, Device},
};
use crate::daemon::Daemon;

pub const UHID: &str = "/dev/uhid";

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

/// Send `data` on channel `cid` as `cmd`, split into packets.
pub(super) fn reply(device: &Device, cid: u32, cmd: u8, data: &[u8]) {
    for packet in ctaphid::frame(cid, cmd, data) {
        device.send(&packet);
    }
}
