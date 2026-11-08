//! The Slash bar without hardware: a fake tree whose device logs its packets.
//! The tests of the packets and of what each change sends go with the
//! clean-room packet.rs (docs/cleanroom/slash-protocol.md).

use super::bar::Bar;
use super::settings::{Change, Input, Settings};
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
