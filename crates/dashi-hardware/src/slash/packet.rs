//! The Slash bar's packets, built and nothing else (no I/O here).
//!
//! Ported from asusctl's `rog-slash` crate, `rog-slash/src/usb.rs` and
//! `rog-slash/src/data.rs` (`SlashMode`): OpenGamingCollective/asusctl 6.5.0,
//! commit `ecd393d` (2026-11-07), whose bytes match gitlab.com/asus-linux/asusctl
//! 6.3.8 (`321b111`). asusctl is MPL-2.0. asusd writes each packet as it is
//! built, at its own length, with `write()` on the device's hidraw node
//! (`rog-platform/src/hid_raw.rs`), so the lengths below are part of the
//! protocol: the 32-byte packets are zero-padded, the others are not.

/// The 32-byte packets' length (`PACKET_SIZE` in usb.rs).
const PACKET_SIZE: usize = 32;

/// The report id for a product: `0x5e` for the 2024 bar (`0b05:193b`),
/// `0x5d` for the 2025 one (`0b05:19b6`) and every later model
/// (usb.rs `report_id`, keyed there by `SlashType`, whose product ids map
/// one to one onto these).
pub(crate) fn report_id(product: u16) -> u8 {
    if product == 0x193b { 0x5e } else { 0x5d }
}

/// A 32-byte packet: the report id, `body`, zeros.
fn padded(report: u8, body: &[u8]) -> Vec<u8> {
    let mut packet = vec![0; PACKET_SIZE];
    packet[0] = report;
    packet[1..=body.len()].copy_from_slice(body);
    packet
}

/// `slash_pkt_init`: the two packets the bar needs after the laptop boots.
pub(crate) fn init(report: u8) -> [Vec<u8>; 2] {
    [
        padded(report, &[0xd7, 0x00, 0x00, 0x01, 0xac]),
        padded(report, &[0xd2, 0x02, 0x01, 0x08, 0xab]),
    ]
}

/// `slash_pkt_enable`.
pub(crate) fn enable(report: u8, on: bool) -> Vec<u8> {
    padded(
        report,
        &[0xd8, 0x02, 0x00, 0x01, if on { 0x00 } else { 0x80 }],
    )
}

/// `slash_pkt_save`: asusd sends it after a mode and after the lid-closed flag.
pub(crate) fn save(report: u8) -> Vec<u8> {
    padded(report, &[0xd4, 0x00, 0x00, 0x01, 0xab])
}

/// The second of `slash_pkt_set_mode`'s two packets, the only one asusd
/// sends (the first is commented out there). Byte 8 is `0x19` for every
/// model; usb.rs notes that the GA605 differs (`0x10`) but sends `0x19`.
pub(crate) fn mode(report: u8, mode: u8) -> Vec<u8> {
    padded(
        report,
        &[
            0xd3, 0x04, 0x00, 0x0c, 0x01, mode, 0x02, 0x19, 0x03, 0x13, 0x04, 0x11, 0x05, 0x12,
            0x06, 0x13,
        ],
    )
}

/// `slash_pkt_options`: on, brightness, interval, 13 bytes.
pub(crate) fn options(report: u8, on: bool, brightness: u8, interval: u8) -> Vec<u8> {
    vec![
        report,
        0xd3,
        0x03,
        0x01,
        0x08,
        0xab,
        0xff,
        0x01,
        u8::from(on),
        0x06,
        brightness,
        0xff,
        interval,
    ]
}

/// When the bar shows: each flag has its own packet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Show {
    Boot,
    Shutdown,
    Sleep,
    Battery,
    BatteryWarning,
    LidClosed,
}

impl Show {
    pub(crate) const ALL: [Show; 6] = [
        Show::Boot,
        Show::Shutdown,
        Show::Sleep,
        Show::Battery,
        Show::BatteryWarning,
        Show::LidClosed,
    ];

    /// The key in `Slash()`'s JSON and `SetSlash`'s dictionary.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Show::Boot => "showOnBoot",
            Show::Shutdown => "showOnShutdown",
            Show::Sleep => "showOnSleep",
            Show::Battery => "showOnBattery",
            Show::BatteryWarning => "showBatteryWarning",
            Show::LidClosed => "showOnLidClosed",
        }
    }

    pub(crate) fn from_key(key: &str) -> Option<Show> {
        Show::ALL.into_iter().find(|show| show.key() == key)
    }

    /// The flag's packet: `slash_pkt_boot`, `_shutdown`, `_sleep`,
    /// `_battery_saver`, `_low_battery`, `_lid_closed`. The sleep packet
    /// sends the flag inverted, as usb.rs does.
    pub(crate) fn packet(self, report: u8, on: bool) -> Vec<u8> {
        let bit = u8::from(on);
        let mask = if on { 0x00 } else { 0x80 };
        match self {
            Show::Boot => vec![
                report, 0xd3, 0x03, 0x01, 0x08, 0xa0, 0x04, 0xff, bit, 0x01, 0xff, 0x00,
            ],
            Show::Sleep => vec![
                report,
                0xd3,
                0x03,
                0x01,
                0x08,
                0xa1,
                0x00,
                0xff,
                u8::from(!on),
                0x02,
                0xff,
                0xff,
            ],
            Show::BatteryWarning => vec![
                report, 0xd3, 0x03, 0x01, 0x08, 0xa2, 0x01, 0xff, bit, 0x02, 0xff, 0xff,
            ],
            Show::Shutdown => vec![
                report, 0xd3, 0x03, 0x01, 0x08, 0xa4, 0x05, 0xff, bit, 0x01, 0xff, 0x00,
            ],
            Show::Battery => vec![report, 0xd8, 0x01, 0x00, 0x01, mask],
            Show::LidClosed => vec![report, 0xd8, 0x00, 0x00, 0x02, 0xa5, mask],
        }
    }
}

/// The animations, by Dashi's name and the byte the bar takes (data.rs
/// `SlashMode`), in asusctl's order.
pub(crate) const MODES: [(&str, u8); 16] = [
    ("static", 0x06),
    ("bounce", 0x10),
    ("slash", 0x12),
    ("loading", 0x13),
    ("bit-stream", 0x1d),
    ("transmission", 0x1a),
    ("flow", 0x19),
    ("flux", 0x25),
    ("phantom", 0x24),
    ("spectrum", 0x26),
    ("hazard", 0x32),
    ("interfacing", 0x33),
    ("ramp", 0x34),
    ("game-over", 0x42),
    ("start", 0x43),
    ("buzzer", 0x44),
];

/// The byte for an animation's name.
pub(crate) fn mode_byte(name: &str) -> Option<u8> {
    MODES
        .iter()
        .find(|(id, _)| *id == name)
        .map(|(_, byte)| *byte)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 32-byte packet written out the way usb.rs builds it: the bytes it
    /// sets, then zeros.
    fn reference(set: &[u8]) -> Vec<u8> {
        let mut packet = vec![0u8; 32];
        packet[..set.len()].copy_from_slice(set);
        packet
    }

    #[test]
    fn report_ids_follow_the_product() {
        assert_eq!(report_id(0x19b6), 0x5d);
        assert_eq!(report_id(0x193b), 0x5e);
    }

    #[test]
    fn init_enable_and_save_are_32_bytes() {
        let [one, two] = init(0x5d);
        assert_eq!(one, reference(&[0x5d, 0xd7, 0x00, 0x00, 0x01, 0xac]));
        assert_eq!(two, reference(&[0x5d, 0xd2, 0x02, 0x01, 0x08, 0xab]));
        assert_eq!(
            enable(0x5d, true),
            reference(&[0x5d, 0xd8, 0x02, 0x00, 0x01, 0x00])
        );
        assert_eq!(
            enable(0x5d, false),
            reference(&[0x5d, 0xd8, 0x02, 0x00, 0x01, 0x80])
        );
        assert_eq!(save(0x5e), reference(&[0x5e, 0xd4, 0x00, 0x00, 0x01, 0xab]));
    }

    #[test]
    fn the_mode_packet_carries_the_animation_byte() {
        assert_eq!(
            mode(0x5d, 0x26),
            reference(&[
                0x5d, 0xd3, 0x04, 0x00, 0x0c, 0x01, 0x26, 0x02, 0x19, 0x03, 0x13, 0x04, 0x11, 0x05,
                0x12, 0x06, 0x13,
            ])
        );
    }

    #[test]
    fn options_are_13_bytes() {
        assert_eq!(
            options(0x5d, true, 0x88, 3),
            vec![
                0x5d, 0xd3, 0x03, 0x01, 0x08, 0xab, 0xff, 0x01, 0x01, 0x06, 0x88, 0xff, 0x03
            ]
        );
        assert_eq!(options(0x5d, false, 255, 0)[8], 0x00);
    }

    #[test]
    fn each_flag_has_its_packet() {
        let r = 0x5d;
        assert_eq!(
            Show::Boot.packet(r, true),
            [
                r, 0xd3, 0x03, 0x01, 0x08, 0xa0, 0x04, 0xff, 0x01, 0x01, 0xff, 0x00
            ]
        );
        assert_eq!(
            Show::Shutdown.packet(r, false),
            [
                r, 0xd3, 0x03, 0x01, 0x08, 0xa4, 0x05, 0xff, 0x00, 0x01, 0xff, 0x00
            ]
        );
        // Sleep is sent inverted (usb.rs: `status = (!enabled) as u8`).
        assert_eq!(
            Show::Sleep.packet(r, true),
            [
                r, 0xd3, 0x03, 0x01, 0x08, 0xa1, 0x00, 0xff, 0x00, 0x02, 0xff, 0xff
            ]
        );
        assert_eq!(
            Show::BatteryWarning.packet(r, true),
            [
                r, 0xd3, 0x03, 0x01, 0x08, 0xa2, 0x01, 0xff, 0x01, 0x02, 0xff, 0xff
            ]
        );
        assert_eq!(
            Show::Battery.packet(r, false),
            [r, 0xd8, 0x01, 0x00, 0x01, 0x80]
        );
        assert_eq!(
            Show::LidClosed.packet(r, true),
            [r, 0xd8, 0x00, 0x00, 0x02, 0xa5, 0x00]
        );
    }

    #[test]
    fn modes_by_name() {
        assert_eq!(mode_byte("bounce"), Some(0x10));
        assert_eq!(mode_byte("game-over"), Some(0x42));
        assert_eq!(mode_byte("Bounce"), None);
        assert_eq!(Show::from_key("showOnLidClosed"), Some(Show::LidClosed));
    }
}
