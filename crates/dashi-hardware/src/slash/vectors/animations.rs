//! The animation vectors, in the order the spec lists them.

use super::hex;
use crate::slash::packet::{self, MODES};

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
