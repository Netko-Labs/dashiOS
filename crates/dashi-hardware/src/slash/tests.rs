//! The Slash bar without hardware: a fake tree whose device logs its packets,
//! and what each change sends. The packets' own bytes are checked against
//! the spec in `vectors.rs`.

use std::io;

use super::bar::{self, Bar};
use super::device::Device;
use super::settings::{Change, Input, Settings};
use super::vectors::{START_UP, hex};
use crate::model::Model;
use crate::state::State;
use crate::sysfs::Sysfs;
use crate::sysfs::testing::TempTree;

fn change(pairs: &[(&str, Input)]) -> Change {
    let mut change = Change::default();
    for (key, value) in pairs {
        change.put(key, value.clone()).expect("a valid change");
    }
    change
}

#[test]
fn a_saved_copy_is_made_valid() {
    let odd = Settings {
        mode: "disco".into(),
        interval: 40,
        ..Settings::default()
    };
    let clean = odd.sanitized();
    assert_eq!((clean.mode.as_str(), clean.interval), ("bounce", 5));
}

const G14: &str = r#"{"id": "GA403WR", "match": {"board_name": "GA403WR"}, "name": "G14",
    "lighting": {"slash": {"usb": "0b05:19b6"}}}"#;

#[test]
fn without_the_device_it_is_unavailable() {
    let tree = TempTree::empty();
    let sysfs = Sysfs::fake(&tree.path);
    let model = Model::parse(G14).unwrap();
    let bar = Bar::from_model(Some(&model)).unwrap();
    let state = State::for_sysfs(&sysfs);
    assert_eq!(bar.describe(&sysfs, &state)["reason"], "no-device");
    assert!(bar.set(&sysfs, &state, &Change::default()).is_err());
    assert_eq!(Bar::from_model(None), None);
}

#[test]
fn the_captured_g14_has_its_bar() {
    let tree = TempTree::fixture("ga403wr");
    let models = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/models");
    let machine = crate::machine::Machine::open(Sysfs::fake(&tree.path), &models);
    assert_eq!(machine.describe()["lighting"]["slash"], true);
    let slash = machine.slash_json();
    assert_eq!(slash["available"], true);
    assert_eq!(slash["device"], "hidraw5");
    // Saved and sent again with the tuning, which has nothing saved.
    let set = machine.set_slash(&change(&[("enabled", Input::Bool(false))]));
    assert_eq!(set.unwrap()["enabled"], false);
    let applied = machine.apply_saved_tuning();
    assert_eq!(applied["slash"], true);
    assert_eq!(applied["reason"], "nothing-saved");
}

/// A device that keeps what it was sent.
#[derive(Default)]
struct Recorder(Vec<Vec<u8>>);

impl Device for Recorder {
    fn write(&mut self, packet: &[u8]) -> io::Result<()> {
        self.0.push(packet.to_vec());
        Ok(())
    }
}

/// What `change` sends from `current`, and the settings it leaves.
fn sent(current: Option<&Settings>, change: &Change) -> (Vec<Vec<u8>>, Settings) {
    let mut device = Recorder::default();
    let next = bar::apply(&mut device, 0x5d, current, change).expect("test: the recorder");
    (device.0, next)
}

fn lines(packets: &[&str]) -> Vec<Vec<u8>> {
    packets.iter().map(|line| hex(line)).collect()
}

const SAVE: &str = "5d d4 00 00 01 ab 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00";

#[test]
fn the_first_change_sends_everything() {
    let (packets, next) = sent(None, &change(&[("brightness", Input::Int(128))]));
    assert_eq!((next.enabled, next.brightness), (true, 128));
    let [first, second, on, _, bounce] = START_UP;
    let expected = lines(&[
        first,
        second,
        on,
        "5d d3 03 01 08 ab ff 01 01 06 80 ff 00",
        bounce,
        // The five flags in asusd's start-up order: boot, sleep, shutdown,
        // battery, the low-battery warning.
        "5d d3 03 01 08 a0 04 ff 01 01 ff 00",
        "5d d3 03 01 08 a1 00 ff 00 02 ff ff",
        "5d d3 03 01 08 a4 05 ff 01 01 ff 00",
        "5d d8 01 00 01 00",
        "5d d3 03 01 08 a2 01 ff 01 02 ff ff",
        "5d d8 00 00 02 a5 00",
        SAVE,
    ]);
    assert_eq!(packets, expected);
}

/// From these settings, this change sends these packets.
type Case<'a> = (&'a Settings, Vec<(&'a str, Input)>, Vec<&'a str>);

#[test]
fn a_change_sends_only_what_differs() {
    let on = Settings::default();
    let dark = Settings {
        enabled: false,
        brightness: 0,
        ..Settings::default()
    };
    let cases: Vec<Case> = vec![
        (&on, vec![("enabled", Input::Bool(true))], vec![]),
        (
            &on,
            vec![("brightness", Input::Int(128))],
            vec!["5d d3 03 01 08 ab ff 01 01 06 80 ff 00"],
        ),
        (
            &on,
            vec![("brightness", Input::Int(0))],
            vec![
                "5d d8 02 00 01 80 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                "5d d3 03 01 08 ab ff 01 00 06 00 ff 00",
            ],
        ),
        (
            &dark,
            vec![("enabled", Input::Bool(true))],
            vec![
                "5d d8 02 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                "5d d3 03 01 08 ab ff 01 01 06 88 ff 00",
            ],
        ),
        (
            &on,
            vec![("interval", Input::Int(3))],
            vec!["5d d3 03 01 08 ab ff 01 01 06 ff ff 03"],
        ),
        (
            &on,
            vec![("mode", Input::Str("flow".into()))],
            vec![
                "5d d3 04 00 0c 01 19 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
                SAVE,
            ],
        ),
        (
            &on,
            vec![("showOnSleep", Input::Bool(false))],
            vec!["5d d3 03 01 08 a1 00 ff 01 02 ff ff"],
        ),
        (
            &on,
            vec![
                ("showOnLidClosed", Input::Bool(false)),
                ("showOnBoot", Input::Bool(false)),
            ],
            vec![
                "5d d3 03 01 08 a0 04 ff 00 01 ff 00",
                "5d d8 00 00 02 a5 80",
                SAVE,
            ],
        ),
    ];
    for (current, pairs, expected) in cases {
        let change = change(&pairs);
        let (packets, _) = sent(Some(current), &change);
        assert_eq!(packets, lines(&expected), "{change:?}");
    }
}

#[test]
fn a_restore_sends_the_full_set() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let bar = Bar::from_model(Some(&Model::parse(G14).unwrap())).unwrap();
    let state = State::for_sysfs(&sysfs);
    // A bar the helper never set is left alone.
    assert!(!bar.restore(&sysfs, &state).unwrap());
    let log = ".dashi-hardware/slash-hidraw5.log";
    assert_eq!(tree.read(log), "");

    bar.set(
        &sysfs,
        &state,
        &change(&[("mode", Input::Str("static".into()))]),
    )
    .unwrap();
    assert_eq!(tree.read(log).lines().count(), 12);
    assert!(bar.restore(&sysfs, &state).unwrap());
    let all = tree.read(log);
    let restored: Vec<&str> = all.lines().skip(12).collect();
    let [first, second, on, options, _] = START_UP;
    assert_eq!(
        restored,
        [
            first,
            second,
            on,
            options,
            "5d d3 04 00 0c 01 06 02 19 03 13 04 11 05 12 06 13 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
            "5d d3 03 01 08 a0 04 ff 01 01 ff 00",
            "5d d3 03 01 08 a1 00 ff 00 02 ff ff",
            "5d d3 03 01 08 a4 05 ff 01 01 ff 00",
            "5d d8 01 00 01 00",
            "5d d3 03 01 08 a2 01 ff 01 02 ff ff",
        ]
    );
}
