//! Every test vector of `docs/cleanroom/slash-protocol.md` (section 6),
//! compared byte for byte, at the vector's length, with what `packet.rs`
//! builds. The vectors are the spec's hex text, unchanged.

mod animations;
mod options;

use super::packet;

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
