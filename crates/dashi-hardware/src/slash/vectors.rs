//! Every test vector of `docs/cleanroom/slash-protocol.md` (section 6),
//! compared byte for byte, at the vector's length, with what `packet.rs`
//! builds. The vectors are the spec's hex text, unchanged.

use super::packet::{self, MODES, Show};

/// Space-separated hex, as the spec writes it.
pub(super) fn hex(text: &str) -> Vec<u8> {
    text.split_whitespace()
        .map(|byte| u8::from_str_radix(byte, 16).expect("test: a hex byte"))
        .collect()
}

#[test]
fn the_report_id_comes_from_the_product() {
    assert_eq!(packet::report_id(0x193b), 0x5e);
    assert_eq!(packet::report_id(0x19b6), 0x5d);
    assert_eq!(packet::report_id(0x1234), 0x5d);
}

#[test]
fn init() {
    let vectors = [
        (
            0x5d,
            "5d d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
            "5d d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
        (
            0x5e,
            "5e d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
            "5e d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
    ];
    for (report, first, second) in vectors {
        assert_eq!(packet::init(report), [hex(first), hex(second)]);
    }
}

#[test]
fn on_off() {
    let vectors = [
        (
            0x5d,
            true,
            "5d d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
        (
            0x5d,
            false,
            "5d d8 02 00 01 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
        (
            0x5e,
            true,
            "5e d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
        (
            0x5e,
            false,
            "5e d8 02 00 01 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
        ),
    ];
    for (report, on, bytes) in vectors {
        assert_eq!(packet::enable(report, on), hex(bytes), "{report:02x} {on}");
    }
}

#[test]
fn save() {
    assert_eq!(
        packet::save(0x5d),
        hex(
            "5d d4 00 00 01 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"
        )
    );
    assert_eq!(
        packet::save(0x5e),
        hex(
            "5e d4 00 00 01 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00"
        )
    );
}

/// The animation vectors: name, report, bytes.
const ANIMATIONS: [(&str, u8, &str); 19] = [
    (
        "static",
        0x5d,
        "5d d3 04 00 0c 01 06 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "bounce",
        0x5d,
        "5d d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "slash",
        0x5d,
        "5d d3 04 00 0c 01 12 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "loading",
        0x5d,
        "5d d3 04 00 0c 01 13 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "bit-stream",
        0x5d,
        "5d d3 04 00 0c 01 1d 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "transmission",
        0x5d,
        "5d d3 04 00 0c 01 1a 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "flow",
        0x5d,
        "5d d3 04 00 0c 01 19 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "flux",
        0x5d,
        "5d d3 04 00 0c 01 25 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "phantom",
        0x5d,
        "5d d3 04 00 0c 01 24 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "spectrum",
        0x5d,
        "5d d3 04 00 0c 01 26 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "hazard",
        0x5d,
        "5d d3 04 00 0c 01 32 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "interfacing",
        0x5d,
        "5d d3 04 00 0c 01 33 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "ramp",
        0x5d,
        "5d d3 04 00 0c 01 34 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "game-over",
        0x5d,
        "5d d3 04 00 0c 01 42 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "start",
        0x5d,
        "5d d3 04 00 0c 01 43 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "buzzer",
        0x5d,
        "5d d3 04 00 0c 01 44 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "static",
        0x5e,
        "5e d3 04 00 0c 01 06 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "bounce",
        0x5e,
        "5e d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
    (
        "buzzer",
        0x5e,
        "5e d3 04 00 0c 01 44 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    ),
];

#[test]
fn every_animation() {
    for (name, report, bytes) in ANIMATIONS {
        let byte = packet::mode_byte(name).expect("test: an animation's name");
        assert_eq!(
            packet::mode(report, byte),
            hex(bytes),
            "{name} {report:02x}"
        );
    }
}

#[test]
fn the_animations_in_their_order() {
    let names: Vec<&str> = MODES.iter().map(|(name, _)| *name).collect();
    let listed: Vec<&str> = ANIMATIONS[..16].iter().map(|(name, ..)| *name).collect();
    assert_eq!(names, listed);
    assert_eq!(packet::mode_byte("Bounce"), None);
    assert_eq!(packet::mode_byte("disco"), None);
    assert_eq!(packet::mode_byte(""), None);
}

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

/// Steps 1–5 of asusd's start-up, with its defaults (on, 255, interval 0,
/// bounce), report `5d`.
pub(super) const START_UP: [&str; 5] = [
    "5d d7 00 00 01 ac 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    "5d d2 02 01 08 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    "5d d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
    "5d d3 03 01 08 ab ff 01 01 06 ff ff 00",
    "5d d3 04 00 0c 01 10 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
];

#[test]
fn a_whole_start_up() {
    let [first, second] = packet::init(0x5d);
    let bounce = packet::mode_byte("bounce").expect("test: bounce is an animation");
    let sent = [
        first,
        second,
        packet::enable(0x5d, true),
        packet::options(0x5d, true, 255, 0),
        packet::mode(0x5d, bounce),
    ];
    let expected: Vec<Vec<u8>> = START_UP.iter().map(|line| hex(line)).collect();
    assert_eq!(sent.to_vec(), expected);
}
