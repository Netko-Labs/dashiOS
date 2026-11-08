//! The Slash bar without hardware: a recording device, and a fake tree whose
//! device logs its packets.

use std::io;

use super::bar::{Bar, apply};
use super::device::Device;
use super::packet::{self, Show};
use super::settings::{Change, Input, Settings};
use crate::model::Model;
use crate::state::State;
use crate::sysfs::Sysfs;
use crate::sysfs::testing::TempTree;

#[derive(Default)]
struct Recorder(Vec<Vec<u8>>);

impl Device for Recorder {
    fn write(&mut self, packet: &[u8]) -> io::Result<()> {
        self.0.push(packet.to_vec());
        Ok(())
    }
}

const R: u8 = 0x5d;

fn change(pairs: &[(&str, Input)]) -> Change {
    let mut change = Change::default();
    for (key, value) in pairs {
        change.put(key, value.clone()).expect("a valid change");
    }
    change
}

#[test]
fn a_change_sends_only_what_differs() {
    let current = Settings::default();
    let mut device = Recorder::default();
    let next = apply(
        &mut device,
        R,
        Some(&current),
        &change(&[("mode", Input::Str("flux".into()))]),
    )
    .unwrap();
    assert_eq!(next.mode, "flux");
    assert_eq!(device.0, vec![packet::mode(R, 0x25), packet::save(R)]);

    let mut device = Recorder::default();
    let next = apply(
        &mut device,
        R,
        Some(&next),
        &change(&[("interval", Input::Int(3))]),
    )
    .unwrap();
    assert_eq!(device.0, vec![packet::options(R, true, 255, 3)]);
    assert_eq!(next.interval, 3);

    // The same value again sends nothing.
    let mut device = Recorder::default();
    apply(
        &mut device,
        R,
        Some(&next),
        &change(&[("interval", Input::Int(3))]),
    )
    .unwrap();
    assert!(device.0.is_empty());
}

#[test]
fn on_off_and_brightness_go_together_as_in_asusd() {
    let off = Settings::default().with(&change(&[("enabled", Input::Bool(false))]));
    assert!(!off.enabled);
    let mut device = Recorder::default();
    apply(
        &mut device,
        R,
        Some(&Settings::default()),
        &change(&[("enabled", Input::Bool(false))]),
    )
    .unwrap();
    assert_eq!(
        device.0,
        vec![packet::enable(R, false), packet::options(R, false, 255, 0)]
    );
    // Brightness 0 turns it off; turning it on at 0 comes back at 0x88.
    let dark = Settings::default().with(&change(&[("brightness", Input::Int(0))]));
    assert!(!dark.enabled);
    let lit = dark.with(&change(&[("enabled", Input::Bool(true))]));
    assert_eq!((lit.enabled, lit.brightness), (true, 0x88));
    // A brightness above 0 turns it on.
    assert!(off.with(&change(&[("brightness", Input::Int(40))])).enabled);
}

#[test]
fn the_first_change_sends_everything() {
    let mut device = Recorder::default();
    let next = apply(
        &mut device,
        R,
        None,
        &change(&[("showOnSleep", Input::Bool(false))]),
    )
    .unwrap();
    let [one, two] = packet::init(R);
    assert_eq!(device.0[0], one);
    assert_eq!(device.0[1], two);
    assert_eq!(device.0[2], packet::enable(R, true));
    assert_eq!(device.0[3], packet::options(R, true, 255, 0));
    assert_eq!(device.0[4], packet::mode(R, 0x10));
    assert!(device.0.contains(&Show::Sleep.packet(R, false)));
    assert!(device.0.contains(&Show::LidClosed.packet(R, true)));
    assert_eq!(device.0.last(), Some(&packet::save(R)));
    assert!(!next.show_on_sleep);
}

#[test]
fn changes_are_validated_and_clamped() {
    let mut c = Change::default();
    c.put("brightness", Input::Int(400)).unwrap();
    c.put("interval", Input::Int(9)).unwrap();
    c.put("showOnBattery", Input::Int(0)).unwrap();
    assert_eq!(c.brightness, Some(255));
    assert_eq!(c.interval, Some(5));
    assert_eq!(c.show, vec![(Show::Battery, false)]);
    c.put("brightness", Input::Int(-3)).unwrap();
    assert_eq!(c.brightness, Some(0));
    assert!(c.put("mode", Input::Str("disco".into())).is_err());
    assert!(c.put("mode", Input::Int(0x10)).is_err());
    assert!(c.put("enabled", Input::Str("yes".into())).is_err());
    assert!(c.put("colour", Input::Int(1)).is_err());
    assert!(matches!(Input::from_text("on"), Input::Bool(true)));
    assert!(matches!(Input::from_text("200"), Input::Int(200)));
    assert!(matches!(Input::from_text("flow"), Input::Str(_)));
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

fn g14_tree() -> (TempTree, Sysfs, Bar) {
    let tree = TempTree::empty();
    tree.file(
        "class/hidraw/hidraw5/device/uevent",
        "DRIVER=asus\nHID_ID=0003:00000B05:000019B6",
    );
    let sysfs = Sysfs::fake(&tree.path);
    let model = Model::parse(G14).expect("the model parses");
    let bar = Bar::from_model(Some(&model)).expect("the model names a bar");
    (tree, sysfs, bar)
}

#[test]
fn set_saves_and_restore_sends_it_again() {
    let (tree, sysfs, bar) = g14_tree();
    let state = State::for_sysfs(&sysfs);
    assert!(!bar.restore(&sysfs, &state).unwrap(), "nothing saved yet");
    assert_eq!(bar.describe(&sysfs, &state)["saved"], false);

    let set = bar
        .set(
            &sysfs,
            &state,
            &change(&[("mode", Input::Str("spectrum".into()))]),
        )
        .unwrap();
    assert_eq!(state.saved_slash(), Some(set));
    let described = bar.describe(&sysfs, &state);
    assert_eq!(described["available"], true);
    assert_eq!(described["device"], "hidraw5");
    assert_eq!(described["mode"], "spectrum");
    assert_eq!(described["modes"].as_array().map(Vec::len), Some(16));

    let log = ".dashi-hardware/slash-hidraw5.log";
    let before = tree.read(log).lines().count();
    assert!(bar.restore(&sysfs, &state).unwrap());
    let lines = tree.read(log);
    let restored: Vec<&str> = lines.lines().skip(before).collect();
    // init, init, enable, options, mode, five flags.
    assert_eq!(restored.len(), 10);
    assert!(restored[0].starts_with("5d d7 00 00 01 ac"));
    assert!(restored[4].starts_with("5d d3 04 00 0c 01 26"));
}

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
