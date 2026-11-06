//! The virtual security key's device: a HID device made through /dev/uhid
//! (the udev rule gives the dashi-secret user that node), with FIDO's usage
//! page, so every browser sees a USB security key and talks CTAPHID to it.
//! Linux's `struct uhid_event` (linux/uhid.h) is written and read by hand.

use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    sync::{Arc, Mutex},
};

use super::ctaphid::PACKET;

const UHID_DESTROY: u32 = 1;
const UHID_OUTPUT: u32 = 6;
const UHID_INPUT2: u32 = 12;
const UHID_CREATE2: u32 = 11;
const DATA_MAX: usize = 4096;
/// sizeof(struct uhid_event): the type, then the largest request (create2's).
pub const EVENT: usize = 4 + 128 + 64 + 64 + 2 + 2 + 4 * 4 + DATA_MAX;
const BUS_USB: u16 = 0x03;

/// FIDO's HID report descriptor: usage page 0xF1D0, 64-byte input and output reports.
pub const REPORT_DESCRIPTOR: [u8; 34] = [
    0x06, 0xd0, 0xf1, 0x09, 0x01, 0xa1, 0x01, 0x09, 0x20, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08,
    0x95, 0x40, 0x81, 0x02, 0x09, 0x21, 0x15, 0x00, 0x26, 0xff, 0x00, 0x75, 0x08, 0x95, 0x40, 0x91,
    0x02, 0xc0,
];

/// The create2 request for Dashi's key.
pub fn create_event() -> Vec<u8> {
    let mut event = vec![0u8; EVENT];
    event[..4].copy_from_slice(&UHID_CREATE2.to_le_bytes());
    let name = b"Dashi Vault Security Key";
    event[4..4 + name.len()].copy_from_slice(name);
    let phys = b"dashi-secretd";
    event[4 + 128..4 + 128 + phys.len()].copy_from_slice(phys);
    let at = 4 + 128 + 64 + 64;
    event[at..at + 2].copy_from_slice(&(REPORT_DESCRIPTOR.len() as u16).to_le_bytes());
    event[at + 2..at + 4].copy_from_slice(&BUS_USB.to_le_bytes());
    // pid.codes' vendor id, a product id for this key; version 0.4.0.
    event[at + 4..at + 8].copy_from_slice(&0x1209u32.to_le_bytes());
    event[at + 8..at + 12].copy_from_slice(&0xda5eu32.to_le_bytes());
    event[at + 12..at + 16].copy_from_slice(&0x0400u32.to_le_bytes());
    event[at + 20..at + 20 + REPORT_DESCRIPTOR.len()].copy_from_slice(&REPORT_DESCRIPTOR);
    event
}

/// An input report (to the browser).
pub fn input_event(report: &[u8; PACKET]) -> Vec<u8> {
    let mut event = vec![0u8; EVENT];
    event[..4].copy_from_slice(&UHID_INPUT2.to_le_bytes());
    event[4..6].copy_from_slice(&(PACKET as u16).to_le_bytes());
    event[6..6 + PACKET].copy_from_slice(report);
    event
}

/// An output report (from the browser) in a kernel event, if it is one: 64
/// bytes, after a report id of 0 when the writer sent one.
pub fn output_report(event: &[u8]) -> Option<[u8; PACKET]> {
    if event.len() < 4 + DATA_MAX + 2
        || u32::from_le_bytes([event[0], event[1], event[2], event[3]]) != UHID_OUTPUT
    {
        return None;
    }
    let size = usize::from(u16::from_le_bytes([
        event[4 + DATA_MAX],
        event[5 + DATA_MAX],
    ]));
    let data = &event[4..4 + size.min(DATA_MAX)];
    let report = match data.len() {
        n if n == PACKET + 1 && data[0] == 0 => &data[1..],
        n if n == PACKET => data,
        _ => return None,
    };
    report.try_into().ok()
}

/// The device, shared by the reading loop and the threads that answer.
#[derive(Clone)]
pub struct Device {
    file: Arc<Mutex<File>>,
    reader: Arc<Mutex<File>>,
}

impl Device {
    pub fn create(path: &str) -> Result<Self, String> {
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("{path}: {e}"))?;
        file.write_all(&create_event())
            .map_err(|e| format!("making the security key: {e}"))?;
        let reader = file.try_clone().map_err(|e| e.to_string())?;
        Ok(Self {
            file: Arc::new(Mutex::new(file)),
            reader: Arc::new(Mutex::new(reader)),
        })
    }

    pub fn send(&self, report: &[u8; PACKET]) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(&input_event(report));
        }
    }

    /// The next kernel event (blocking).
    pub fn next(&self) -> Option<Vec<u8>> {
        let mut event = vec![0u8; EVENT];
        let read = self.reader.lock().ok()?.read(&mut event).ok()?;
        (read >= 4).then(|| {
            event.truncate(read);
            event
        })
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        if Arc::strong_count(&self.file) == 1
            && let Ok(mut file) = self.file.lock()
        {
            let mut event = vec![0u8; EVENT];
            event[..4].copy_from_slice(&UHID_DESTROY.to_le_bytes());
            let _ = file.write_all(&event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_events_are_laid_out_as_linux_wants() {
        assert_eq!(EVENT, 4376);
        let create = create_event();
        assert_eq!(&create[..4], &11u32.to_le_bytes());
        assert_eq!(&create[260..262], &34u16.to_le_bytes());
        assert_eq!(&create[280..283], &[0x06, 0xd0, 0xf1]);
        let report = [7u8; PACKET];
        let input = input_event(&report);
        assert_eq!(&input[4..6], &64u16.to_le_bytes());
        assert_eq!(&input[6..70], &report);
    }

    #[test]
    fn output_reports_come_with_or_without_a_report_id() {
        let mut event = vec![0u8; EVENT];
        event[..4].copy_from_slice(&UHID_OUTPUT.to_le_bytes());
        event[5..69].copy_from_slice(&[9u8; 64]);
        event[4 + DATA_MAX..6 + DATA_MAX].copy_from_slice(&65u16.to_le_bytes());
        assert_eq!(output_report(&event), Some([9u8; 64]));
        event[4 + DATA_MAX..6 + DATA_MAX].copy_from_slice(&12u16.to_le_bytes());
        assert_eq!(output_report(&event), None);
        event[..4].copy_from_slice(&UHID_INPUT2.to_le_bytes());
        assert_eq!(output_report(&event), None);
    }
}
