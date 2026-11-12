//! The Slash bar's device: found among the hidraw nodes by its USB
//! vendor:product id (sysfs), written with `write()` on `/dev/hidrawN` as
//! asusd does (`rog-platform/src/hid_raw.rs`). Behind `Device`, so the rest
//! is tested without hardware; on a fake tree the packets go to a file.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

use crate::sysfs::Sysfs;

/// Where packets go.
pub(crate) trait Device {
    fn write(&mut self, packet: &[u8]) -> io::Result<()>;
}

/// A USB id from the model database (`0b05:19b6`).
pub(crate) fn parse_usb_id(text: &str) -> Option<(u16, u16)> {
    let (vendor, product) = text.split_once(':')?;
    Some((
        u16::from_str_radix(vendor, 16).ok()?,
        u16::from_str_radix(product, 16).ok()?,
    ))
}

/// A hidraw device's `HID_ID` (`0003:00000B05:000019B6`): USB (bus 3), and
/// its vendor and product.
fn hid_id_is(uevent: &str, vendor: u16, product: u16) -> bool {
    let Some(id) = uevent.lines().find_map(|line| line.strip_prefix("HID_ID=")) else {
        return false;
    };
    let mut parts = id.split(':').map(|part| u32::from_str_radix(part, 16).ok());
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(Some(3)), Some(Some(v)), Some(Some(p))) if v == u32::from(vendor) && p == u32::from(product)
    )
}

/// Whether a report descriptor declares `report` (a Report ID item, `0x85 id`).
fn declares_report(descriptor: &[u8], report: u8) -> bool {
    descriptor.windows(2).any(|pair| pair == [0x85, report])
}

/// `hidraw` and digits: the only names that become a `/dev` path.
fn is_hidraw_name(name: &str) -> bool {
    name.strip_prefix("hidraw")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// The hidraw node (`hidraw5`) of the device `vendor:product`. With several
/// interfaces, the one whose report descriptor declares `report` (asusd skips
/// the others of a composite device the same way), else the first.
pub(crate) fn find(sysfs: &Sysfs, vendor: u16, product: u16, report: u8) -> Option<String> {
    let matching: Vec<String> = sysfs
        .list("class/hidraw")
        .into_iter()
        .filter(|name| is_hidraw_name(name))
        .filter(|name| {
            sysfs
                .read(&format!("class/hidraw/{name}/device/uevent"))
                .is_some_and(|uevent| hid_id_is(&uevent, vendor, product))
        })
        .collect();
    matching
        .iter()
        .find(|name| {
            sysfs
                .read_bytes(&format!("class/hidraw/{name}/device/report_descriptor"))
                .is_some_and(|descriptor| declares_report(&descriptor, report))
        })
        .or(matching.first())
        .cloned()
}

/// The node, opened for writing: `/dev/<node>` on the real tree; on a fake
/// tree a log of the packets, one hex line each, in the helper's state
/// directory beside the fixture (`.dashi-hardware/slash-<node>.log`).
pub(crate) fn open(sysfs: &Sysfs, node: &str) -> io::Result<Box<dyn Device>> {
    if !is_hidraw_name(node) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a hidraw node",
        ));
    }
    if sysfs.is_fake() {
        let dir = sysfs.root().join(".dashi-hardware");
        fs::create_dir_all(&dir)?;
        return Ok(Box::new(Log {
            path: dir.join(format!("slash-{node}.log")),
        }));
    }
    let path = PathBuf::from("/dev").join(node);
    let file = OpenOptions::new().write(true).open(&path)?;
    Ok(Box::new(Hidraw { path, file }))
}

struct Hidraw {
    path: PathBuf,
    file: fs::File,
}

impl Device for Hidraw {
    fn write(&mut self, packet: &[u8]) -> io::Result<()> {
        self.file
            .write_all(packet)
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", self.path.display())))
    }
}

struct Log {
    path: PathBuf,
}

impl Device for Log {
    fn write(&mut self, packet: &[u8]) -> io::Result<()> {
        let line: Vec<String> = packet.iter().map(|b| format!("{b:02x}")).collect();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{}", line.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sysfs::testing::TempTree;

    const G14_KEYBOARD: &str = "DRIVER=asus\nHID_ID=0003:00000B05:000019B6\n\
        HID_NAME=ITE Tech. Inc. ITE Device(8910)\nHID_PHYS=usb-0000:67:00.0-4/input0";
    const RECEIVER: &str = "DRIVER=hid-generic\nHID_ID=0003:0000046D:0000C548";

    #[test]
    fn usb_ids_parse() {
        assert_eq!(parse_usb_id("0b05:19b6"), Some((0x0b05, 0x19b6)));
        assert_eq!(parse_usb_id("0b05"), None);
        assert_eq!(parse_usb_id("zz05:19b6"), None);
    }

    #[test]
    fn the_bar_is_found_by_its_hid_id() {
        let tree = TempTree::empty();
        tree.file("class/hidraw/hidraw0/device/uevent", RECEIVER);
        tree.file("class/hidraw/hidraw5/device/uevent", G14_KEYBOARD);
        // Not a USB device: bus 0018 is I2C.
        tree.file(
            "class/hidraw/hidraw4/device/uevent",
            "HID_ID=0018:00000B05:000019B6",
        );
        let sysfs = Sysfs::fake(&tree.path);
        assert_eq!(
            find(&sysfs, 0x0b05, 0x19b6, 0x5d).as_deref(),
            Some("hidraw5")
        );
        assert_eq!(find(&sysfs, 0x0b05, 0x193b, 0x5e), None);
    }

    #[test]
    fn of_several_interfaces_the_one_declaring_the_report_wins() {
        let tree = TempTree::empty();
        tree.file("class/hidraw/hidraw5/device/uevent", G14_KEYBOARD);
        tree.file("class/hidraw/hidraw7/device/uevent", G14_KEYBOARD);
        let descriptor = tree
            .path
            .join("class/hidraw/hidraw7/device/report_descriptor");
        fs::write(descriptor, [0x06, 0x31, 0xff, 0x85, 0x5d, 0x09, 0x76]).unwrap();
        let sysfs = Sysfs::fake(&tree.path);
        assert_eq!(
            find(&sysfs, 0x0b05, 0x19b6, 0x5d).as_deref(),
            Some("hidraw7")
        );
    }

    #[test]
    fn only_hidraw_names_become_paths() {
        assert!(is_hidraw_name("hidraw12"));
        assert!(!is_hidraw_name("hidraw"));
        assert!(!is_hidraw_name("hidraw1/../../x"));
        let tree = TempTree::empty();
        assert!(open(&Sysfs::fake(&tree.path), "../sda").is_err());
    }

    #[test]
    fn a_fake_tree_logs_the_packets() {
        let tree = TempTree::empty();
        let sysfs = Sysfs::fake(&tree.path);
        let mut device = open(&sysfs, "hidraw5").unwrap();
        device.write(&[0x5d, 0xd4, 0x00]).unwrap();
        assert_eq!(tree.read(".dashi-hardware/slash-hidraw5.log"), "5d d4 00");
    }
}
