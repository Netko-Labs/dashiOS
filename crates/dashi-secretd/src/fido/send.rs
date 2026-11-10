//! Sending a CTAPHID message back to the browser as packets.

use super::{ctaphid, uhid::Device};

/// Send `data` on channel `cid` as `cmd`, split into packets.
pub(super) fn reply(device: &Device, cid: u32, cmd: u8, data: &[u8]) {
    for packet in ctaphid::frame(cid, cmd, data) {
        device.send(&packet);
    }
}
