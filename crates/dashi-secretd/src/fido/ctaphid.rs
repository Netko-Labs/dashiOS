//! CTAPHID (FIDO's CTAP 2.1, section 11.2): messages cut into 64-byte HID
//! reports. An initialization packet carries the channel, the command (high
//! bit set) and the length, then up to 57 bytes; continuation packets carry
//! the channel, a sequence number, and up to 59 more. Everything from the
//! device's reader is untrusted: a bad packet is an error on its channel.

pub const PACKET: usize = 64;
const INIT_DATA: usize = PACKET - 7;
const CONT_DATA: usize = PACKET - 5;
/// The longest message: what 128 continuation packets hold.
pub const MAX_MESSAGE: usize = INIT_DATA + 128 * CONT_DATA;
pub const BROADCAST: u32 = 0xffff_ffff;

pub const PING: u8 = 0x01;
pub const MSG: u8 = 0x03;
pub const INIT: u8 = 0x06;
pub const WINK: u8 = 0x08;
pub const CBOR: u8 = 0x10;
pub const CANCEL: u8 = 0x11;
pub const KEEPALIVE: u8 = 0x3b;
pub const ERROR: u8 = 0x3f;

pub const ERR_INVALID_CMD: u8 = 0x01;
pub const ERR_INVALID_LEN: u8 = 0x03;
pub const ERR_INVALID_SEQ: u8 = 0x04;
pub const ERR_CHANNEL_BUSY: u8 = 0x06;
pub const ERR_INVALID_CHANNEL: u8 = 0x0b;

/// KEEPALIVE's status while the person is asked.
pub const STATUS_UPNEEDED: u8 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub cid: u32,
    pub cmd: u8,
    pub data: Vec<u8>,
}

/// Something wrong on a channel: answer it with ERROR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HidError {
    pub cid: u32,
    pub code: u8,
}

struct Partial {
    cid: u32,
    cmd: u8,
    len: usize,
    data: Vec<u8>,
    seq: u8,
}

/// Puts packets back together into messages, one at a time.
#[derive(Default)]
pub struct Assembler {
    partial: Option<Partial>,
}

fn cid_of(packet: &[u8]) -> u32 {
    u32::from_be_bytes([packet[0], packet[1], packet[2], packet[3]])
}

impl Assembler {
    pub fn push(&mut self, packet: &[u8]) -> Result<Option<Message>, HidError> {
        if packet.len() < PACKET {
            return Err(HidError {
                cid: 0,
                code: ERR_INVALID_LEN,
            });
        }
        let cid = cid_of(packet);
        let kind = packet[4];
        if cid == 0 {
            return Err(HidError {
                cid,
                code: ERR_INVALID_CHANNEL,
            });
        }
        if kind & 0x80 != 0 {
            let cmd = kind & 0x7f;
            let len = usize::from(u16::from_be_bytes([packet[5], packet[6]]));
            if len > MAX_MESSAGE {
                return Err(HidError {
                    cid,
                    code: ERR_INVALID_LEN,
                });
            }
            if let Some(busy) = &self.partial
                && busy.cid != cid
                && cmd != INIT
            {
                return Err(HidError {
                    cid,
                    code: ERR_CHANNEL_BUSY,
                });
            }
            let take = len.min(INIT_DATA);
            let partial = Partial {
                cid,
                cmd,
                len,
                data: packet[7..7 + take].to_vec(),
                seq: 0,
            };
            return Ok(self.finish_or_keep(partial));
        }
        let Some(mut partial) = self.partial.take() else {
            // A continuation with nothing begun: ignored, as the spec says.
            return Ok(None);
        };
        if partial.cid != cid {
            self.partial = Some(partial);
            return Err(HidError {
                cid,
                code: ERR_CHANNEL_BUSY,
            });
        }
        if kind != partial.seq || kind > 0x7f {
            return Err(HidError {
                cid,
                code: ERR_INVALID_SEQ,
            });
        }
        partial.seq += 1;
        let take = (partial.len - partial.data.len()).min(CONT_DATA);
        partial.data.extend_from_slice(&packet[5..5 + take]);
        Ok(self.finish_or_keep(partial))
    }

    fn finish_or_keep(&mut self, partial: Partial) -> Option<Message> {
        if partial.data.len() >= partial.len {
            self.partial = None;
            return Some(Message {
                cid: partial.cid,
                cmd: partial.cmd,
                data: partial.data,
            });
        }
        self.partial = Some(partial);
        None
    }
}

/// `data` for `cmd` on `cid`, as packets.
pub fn frame(cid: u32, cmd: u8, data: &[u8]) -> Vec<[u8; PACKET]> {
    let mut packets = Vec::new();
    let mut first = [0u8; PACKET];
    first[..4].copy_from_slice(&cid.to_be_bytes());
    first[4] = cmd | 0x80;
    first[5..7].copy_from_slice(&(data.len().min(u16::MAX as usize) as u16).to_be_bytes());
    let head = data.len().min(INIT_DATA);
    first[7..7 + head].copy_from_slice(&data[..head]);
    packets.push(first);
    for (seq, chunk) in data[head..].chunks(CONT_DATA).enumerate().take(128) {
        let mut packet = [0u8; PACKET];
        packet[..4].copy_from_slice(&cid.to_be_bytes());
        packet[4] = seq as u8;
        packet[5..5 + chunk.len()].copy_from_slice(chunk);
        packets.push(packet);
    }
    packets
}

/// INIT's answer: the nonce back, a new channel, and what this key is.
pub fn init_reply(nonce: &[u8], new_cid: u32) -> Vec<u8> {
    let mut out = nonce.get(..8).unwrap_or(&[0; 8]).to_vec();
    out.extend_from_slice(&new_cid.to_be_bytes());
    // CTAPHID protocol 2; device version 0.4.0; capabilities: CBOR, no MSG (U2F).
    out.extend_from_slice(&[2, 0, 4, 0, 0x04 | 0x08]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_messages_are_cut_and_put_back_together() {
        let data: Vec<u8> = (0..300u32).map(|i| i as u8).collect();
        let packets = frame(0x0102_0304, CBOR, &data);
        assert_eq!(packets.len(), 1 + (300usize - 57).div_ceil(59));
        assert_eq!(packets[0][4], CBOR | 0x80);
        assert_eq!(packets[1][4], 0);
        let mut assembler = Assembler::default();
        let mut got = None;
        for packet in &packets {
            got = assembler.push(packet).unwrap();
        }
        assert_eq!(
            got,
            Some(Message {
                cid: 0x0102_0304,
                cmd: CBOR,
                data
            })
        );
    }

    #[test]
    fn bad_packets_are_errors_on_their_channel() {
        let mut assembler = Assembler::default();
        let mut packets = frame(7, CBOR, &[1u8; 100]);
        packets[1][4] = 5; // a sequence number out of order
        assert_eq!(assembler.push(&packets[0]), Ok(None));
        assert_eq!(
            assembler.push(&packets[1]),
            Err(HidError {
                cid: 7,
                code: ERR_INVALID_SEQ
            })
        );
        // Channel 0 is never valid; a length over the maximum is refused.
        assert!(assembler.push(&frame(0, PING, &[])[0]).is_err());
        let mut huge = frame(9, CBOR, &[]);
        huge[0][5..7].copy_from_slice(&u16::MAX.to_be_bytes());
        assert_eq!(
            assembler.push(&huge[0]),
            Err(HidError {
                cid: 9,
                code: ERR_INVALID_LEN
            })
        );
        assert!(assembler.push(&[0u8; 10]).is_err());
    }

    #[test]
    fn another_channel_waits_its_turn() {
        let mut assembler = Assembler::default();
        let first = frame(1, CBOR, &[0u8; 100]);
        assert_eq!(assembler.push(&first[0]), Ok(None));
        let other = frame(2, PING, &[1, 2, 3]);
        assert_eq!(
            assembler.push(&other[0]),
            Err(HidError {
                cid: 2,
                code: ERR_CHANNEL_BUSY
            })
        );
        assert!(assembler.push(&first[1]).unwrap().is_some());
    }

    #[test]
    fn init_answers_with_a_channel() {
        let reply = init_reply(&[1, 2, 3, 4, 5, 6, 7, 8], 0x42);
        assert_eq!(&reply[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(&reply[8..12], &0x42u32.to_be_bytes());
        assert_eq!(reply.len(), 17);
    }
}
