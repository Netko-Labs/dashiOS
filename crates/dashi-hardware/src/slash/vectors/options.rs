//! The option and show-flag vectors.

use super::hex;
use crate::slash::packet::{self, Show};

#[test]
fn options() {
    let vectors: [(u8, bool, u8, u8, &str); 10] = [
        (0x5d, true, 255, 0, "5d d3 03 01 08 ab ff 01 01 06 ff ff 00"),
        (0x5d, true, 0, 5, "5d d3 03 01 08 ab ff 01 01 06 00 ff 05"),
        (0x5d, false, 0, 0, "5d d3 03 01 08 ab ff 01 00 06 00 ff 00"),
        (
            0x5d,
            false,
            255,
            0,
            "5d d3 03 01 08 ab ff 01 00 06 ff ff 00",
        ),
        (
            0x5d,
            true,
            0x88,
            3,
            "5d d3 03 01 08 ab ff 01 01 06 88 ff 03",
        ),
        (0x5d, true, 1, 5, "5d d3 03 01 08 ab ff 01 01 06 01 ff 05"),
        (0x5d, true, 128, 1, "5d d3 03 01 08 ab ff 01 01 06 80 ff 01"),
        (0x5e, true, 255, 0, "5e d3 03 01 08 ab ff 01 01 06 ff ff 00"),
        (0x5e, false, 0, 0, "5e d3 03 01 08 ab ff 01 00 06 00 ff 00"),
        (0x5e, true, 0, 5, "5e d3 03 01 08 ab ff 01 01 06 00 ff 05"),
    ];
    for (report, on, brightness, interval, bytes) in vectors {
        assert_eq!(
            packet::options(report, on, brightness, interval),
            hex(bytes),
            "{report:02x} {on} {brightness} {interval}"
        );
    }
}

#[test]
fn flags() {
    use Show::*;
    let vectors: [(u8, Show, bool, &str); 18] = [
        (0x5d, Boot, true, "5d d3 03 01 08 a0 04 ff 01 01 ff 00"),
        (0x5d, Boot, false, "5d d3 03 01 08 a0 04 ff 00 01 ff 00"),
        (0x5d, Shutdown, true, "5d d3 03 01 08 a4 05 ff 01 01 ff 00"),
        (0x5d, Shutdown, false, "5d d3 03 01 08 a4 05 ff 00 01 ff 00"),
        (0x5d, Sleep, true, "5d d3 03 01 08 a1 00 ff 00 02 ff ff"),
        (0x5d, Sleep, false, "5d d3 03 01 08 a1 00 ff 01 02 ff ff"),
        (
            0x5d,
            BatteryWarning,
            true,
            "5d d3 03 01 08 a2 01 ff 01 02 ff ff",
        ),
        (
            0x5d,
            BatteryWarning,
            false,
            "5d d3 03 01 08 a2 01 ff 00 02 ff ff",
        ),
        (0x5d, Battery, true, "5d d8 01 00 01 00"),
        (0x5d, Battery, false, "5d d8 01 00 01 80"),
        (0x5d, LidClosed, true, "5d d8 00 00 02 a5 00"),
        (0x5d, LidClosed, false, "5d d8 00 00 02 a5 80"),
        (0x5e, Boot, true, "5e d3 03 01 08 a0 04 ff 01 01 ff 00"),
        (0x5e, Sleep, true, "5e d3 03 01 08 a1 00 ff 00 02 ff ff"),
        (0x5e, Sleep, false, "5e d3 03 01 08 a1 00 ff 01 02 ff ff"),
        (0x5e, Battery, false, "5e d8 01 00 01 80"),
        (0x5e, LidClosed, true, "5e d8 00 00 02 a5 00"),
        (0x5e, LidClosed, false, "5e d8 00 00 02 a5 80"),
    ];
    for (report, flag, on, bytes) in vectors {
        assert_eq!(
            flag.packet(report, on),
            hex(bytes),
            "{report:02x} {flag:?} {on}"
        );
    }
}

#[test]
fn the_flags_keys() {
    let keys: Vec<&str> = Show::ALL.iter().map(|flag| flag.key()).collect();
    assert_eq!(
        keys,
        [
            "showOnBoot",
            "showOnShutdown",
            "showOnSleep",
            "showOnBattery",
            "showBatteryWarning",
            "showOnLidClosed"
        ]
    );
    for flag in Show::ALL {
        assert_eq!(Show::from_key(flag.key()), Some(flag));
    }
    assert_eq!(Show::from_key("ShowOnBoot"), None);
    assert_eq!(Show::from_key("enabled"), None);
}
