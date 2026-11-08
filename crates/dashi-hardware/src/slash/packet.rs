//! The Slash bar's packets, as bytes and nothing else: no I/O. Implemented
//! clean room from `docs/cleanroom/slash-protocol.md` (sections 2, 3 and 7);
//! the section numbers below are that spec's.
//!
//! Byte 0 of every packet is the report id ([`report_id`]). Some packets are
//! zero-padded to 32 bytes; the others are short and keep their own length
//! (6, 7, 12 or 13). The length is part of the protocol, so each function
//! returns exactly what is written.

/// The length of a padded packet.
const PADDED: usize = 32;

/// The byte the `0xd8` packets (on/off, on battery, lid closed) carry for
/// "on" and "off" (2.2, 2.6).
const fn on_or_dark(on: bool) -> u8 {
    if on { 0x00 } else { 0x80 }
}

/// `report`, then `body`, zero-padded to 32 bytes.
fn padded(report: u8, body: &[u8]) -> Vec<u8> {
    let mut packet = short(report, body);
    packet.resize(PADDED, 0x00);
    packet
}

/// `report`, then `body`, at that length.
fn short(report: u8, body: &[u8]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(PADDED);
    packet.push(report);
    packet.extend_from_slice(body);
    packet
}

/// The report id for the bar's USB product id: `0x5e` for the first bar
/// (`0x193b`), `0x5d` for every other (section 1).
pub(crate) fn report_id(product: u16) -> u8 {
    if product == 0x193b { 0x5e } else { 0x5d }
}

/// The two packets the bar needs once after boot, first then second (2.1).
pub(crate) fn init(report: u8) -> [Vec<u8>; 2] {
    [
        padded(report, &[0xd7, 0x00, 0x00, 0x01, 0xac]),
        padded(report, &[0xd2, 0x02, 0x01, 0x08, 0xab]),
    ]
}

/// Turn the bar on or off (2.2).
pub(crate) fn enable(report: u8, on: bool) -> Vec<u8> {
    padded(report, &[0xd8, 0x02, 0x00, 0x01, on_or_dark(on)])
}

/// Make the bar keep what it was just sent (2.3).
pub(crate) fn save(report: u8) -> Vec<u8> {
    padded(report, &[0xd4, 0x00, 0x00, 0x01, 0xab])
}

/// Play the animation whose byte is `mode` (2.4): six slot pairs after the
/// header, of which only the first, the animation, varies.
pub(crate) fn mode(report: u8, mode: u8) -> Vec<u8> {
    let header = [0xd3, 0x04, 0x00, 0x0c];
    let slots = [
        (1, mode),
        (2, 0x19),
        (3, 0x13),
        (4, 0x11),
        (5, 0x12),
        (6, 0x13),
    ];
    let mut body = header.to_vec();
    body.extend(slots.iter().flat_map(|&(slot, value)| [slot, value]));
    padded(report, &body)
}

/// On, brightness and interval in one packet (2.5), each sent as given (the
/// caller clamps). Its "on" byte is `0x01`, the opposite of [`enable`]'s.
pub(crate) fn options(report: u8, on: bool, brightness: u8, interval: u8) -> Vec<u8> {
    short(
        report,
        &[
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
        ],
    )
}

/// The animations: Dashi's name and its byte, in the order `Slash()` lists
/// them (section 3).
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

/// The byte of the animation named exactly `name`.
pub(crate) fn mode_byte(name: &str) -> Option<u8> {
    MODES
        .iter()
        .find(|(known, _)| *known == name)
        .map(|&(_, byte)| byte)
}

/// When the bar shows: six flags, a packet each (2.6).
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
    /// Every flag, in the order changed flags are sent (lid closed last).
    pub(crate) const ALL: [Show; 6] = [
        Show::Boot,
        Show::Shutdown,
        Show::Sleep,
        Show::Battery,
        Show::BatteryWarning,
        Show::LidClosed,
    ];

    /// Its key in `Slash()`'s JSON and `SetSlash`'s dictionary.
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

    /// The flag whose key is exactly `key`.
    pub(crate) fn from_key(key: &str) -> Option<Show> {
        Show::ALL.into_iter().find(|flag| flag.key() == key)
    }

    /// The packet that sets this flag; `on` is the person's setting (the bar
    /// shows then).
    pub(crate) fn packet(self, report: u8, on: bool) -> Vec<u8> {
        // The four 12-byte flags: offsets 5 and 6, the flag's byte at 8
        // (inverted for sleep), then offsets 9 and 11.
        let twelve = |which: u8, sixth: u8, flag: u8, ninth: u8, last: u8| {
            short(
                report,
                &[
                    0xd3, 0x03, 0x01, 0x08, which, sixth, 0xff, flag, ninth, 0xff, last,
                ],
            )
        };
        match self {
            Show::Boot => twelve(0xa0, 0x04, u8::from(on), 0x01, 0x00),
            Show::Shutdown => twelve(0xa4, 0x05, u8::from(on), 0x01, 0x00),
            Show::Sleep => twelve(0xa1, 0x00, u8::from(!on), 0x02, 0xff),
            Show::BatteryWarning => twelve(0xa2, 0x01, u8::from(on), 0x02, 0xff),
            Show::Battery => short(report, &[0xd8, 0x01, 0x00, 0x01, on_or_dark(on)]),
            Show::LidClosed => short(report, &[0xd8, 0x00, 0x00, 0x02, 0xa5, on_or_dark(on)]),
        }
    }
}
