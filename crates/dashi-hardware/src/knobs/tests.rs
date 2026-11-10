//! Each backend against the G14's captured tree (data/fixtures/ga403wr).

use serde_json::json;

use super::*;
use crate::model::Model;
use crate::sysfs::Sysfs;
use crate::sysfs::testing::TempTree;

fn g14() -> (TempTree, Sysfs, Vec<Found>) {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let model = Model::parse(include_str!("../../../../data/models/GA403WR.json")).expect("parses");
    let found = discover(&sysfs, Some(&model));
    (tree, sysfs, found)
}

fn knob(found: &[Found], knob: Knob) -> &Found {
    found
        .iter()
        .find(|f| f.knob == knob)
        .unwrap_or_else(|| panic!("the G14 has {}", knob.name()))
}

#[test]
fn the_g14_has_every_knob() {
    let (_tree, _sysfs, found) = g14();
    let names: Vec<&str> = found.iter().map(|f| f.knob.name()).collect();
    assert_eq!(names, Knob::ALL.map(Knob::name).to_vec());
}

#[test]
fn power_limits_come_from_the_firmware_ranges() {
    let (_tree, sysfs, found) = g14();
    let spl = knob(&found, Knob::PptSpl);
    assert_eq!(
        spl.describe(&sysfs),
        json!({"value": 80, "min": 15, "max": 80, "unit": "W"})
    );
    let fppt = knob(&found, Knob::PptFppt);
    assert_eq!(fppt.describe(&sysfs)["min"], json!(35));
    assert_eq!(
        knob(&found, Knob::NvTempTarget).describe(&sysfs),
        json!({"value": 87, "min": 75, "max": 87, "unit": "°C"})
    );
}

#[test]
fn values_are_clamped_to_the_range_and_written() {
    let (tree, sysfs, found) = g14();
    let spl = knob(&found, Knob::PptSpl);
    assert_eq!(spl.set(&sysfs, Value::U32(200)).ok(), Some(Value::U32(80)));
    assert_eq!(spl.set(&sysfs, Value::U32(3)).ok(), Some(Value::U32(15)));
    assert_eq!(
        tree.read("class/firmware-attributes/asus-armoury/attributes/ppt_pl1_spl/current_value"),
        "15"
    );
    let limit = knob(&found, Knob::ChargeLimit);
    assert_eq!(limit.set(&sysfs, Value::U32(5)).ok(), Some(Value::U32(20)));
    assert_eq!(limit.set(&sysfs, Value::U32(80)).ok(), Some(Value::U32(80)));
    assert_eq!(
        tree.read("class/power_supply/BAT1/charge_control_end_threshold"),
        "80"
    );
}

#[test]
fn the_model_narrows_a_range_but_never_widens_it() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let model = Model::parse(
        r#"{"id": "T", "name": "T", "match": {"board_name": "GA403WR"},
            "limits": {"ppt-spl": [20, 60], "charge-limit": [10, 200]}}"#,
    )
    .expect("parses");
    let found = discover(&sysfs, Some(&model));
    let spl = knob(&found, Knob::PptSpl);
    assert_eq!(spl.set(&sysfs, Value::U32(80)).ok(), Some(Value::U32(60)));
    let limit = knob(&found, Knob::ChargeLimit);
    assert_eq!(limit.describe(&sysfs)["min"], json!(20));
    assert_eq!(limit.describe(&sysfs)["max"], json!(100));
}

#[test]
fn quiet_is_low_power_and_both_handlers_follow() {
    let (tree, sysfs, found) = g14();
    let profile = knob(&found, Knob::PlatformProfile);
    assert_eq!(
        profile.describe(&sysfs),
        json!({"value": "balanced", "choices": ["low-power", "balanced", "performance"]})
    );
    assert!(profile.set(&sysfs, Value::Str("low-power".into())).is_ok());
    assert_eq!(tree.read("firmware/acpi/platform_profile"), "quiet");
    assert_eq!(
        tree.read("class/platform-profile/platform-profile-0/profile"),
        "low-power"
    );
    assert_eq!(
        tree.read("class/platform-profile/platform-profile-1/profile"),
        "quiet"
    );
    assert_eq!(profile.read(&sysfs), Some(Value::Str("low-power".into())));
    assert!(profile.set(&sysfs, Value::Str("turbo".into())).is_err());
}

#[test]
fn without_the_legacy_file_each_handler_is_written() {
    let (tree, sysfs, _) = g14();
    std::fs::remove_file(tree.path.join("firmware/acpi/platform_profile")).expect("removable");
    let found = discover(&sysfs, None);
    let profile = knob(&found, Knob::PlatformProfile);
    assert!(
        profile
            .set(&sysfs, Value::Str("performance".into()))
            .is_ok()
    );
    assert_eq!(
        tree.read("class/platform-profile/platform-profile-0/profile"),
        "performance"
    );
    assert_eq!(
        tree.read("class/platform-profile/platform-profile-1/profile"),
        "performance"
    );
}

#[test]
fn cpufreq_knobs_reach_every_cpu() {
    let (tree, sysfs, found) = g14();
    let epp = knob(&found, Knob::Epp);
    assert!(epp.set(&sysfs, Value::Str("power".into())).is_ok());
    for cpu in ["cpu0", "cpu11", "cpu23"] {
        assert_eq!(
            tree.read(&format!(
                "devices/system/cpu/{cpu}/cpufreq/energy_performance_preference"
            )),
            "power"
        );
    }
    assert!(epp.set(&sysfs, Value::Str("custom".into())).is_err());

    let cap = knob(&found, Knob::CpuMaxFreq);
    assert_eq!(cap.read(&sysfs), Some(Value::U32(0)), "no cap at first");
    assert_eq!(
        cap.set(&sysfs, Value::U32(3_900_000)).ok(),
        Some(Value::U32(3_900_000))
    );
    assert_eq!(
        tree.read("devices/system/cpu/cpu7/cpufreq/scaling_max_freq"),
        "3900000"
    );
    assert_eq!(cap.read(&sysfs), Some(Value::U32(3_900_000)));
    assert_eq!(cap.set(&sysfs, Value::U32(0)).ok(), Some(Value::U32(0)));
    assert_eq!(cap.read(&sysfs), Some(Value::U32(0)));
    assert_eq!(
        cap.set(&sysfs, Value::U32(1)).ok(),
        Some(Value::U32(605_264))
    );

    let boost = knob(&found, Knob::Boost);
    assert!(boost.set(&sysfs, Value::Bool(false)).is_ok());
    assert_eq!(tree.read("devices/system/cpu/cpufreq/boost"), "0");
}

#[test]
fn booleans_and_the_mux() {
    let (tree, sysfs, found) = g14();
    let overdrive = knob(&found, Knob::PanelOverdrive);
    assert_eq!(overdrive.read(&sysfs), Some(Value::Bool(true)));
    assert!(overdrive.set(&sysfs, Value::Bool(false)).is_ok());
    assert_eq!(
        tree.read(
            "class/firmware-attributes/asus-armoury/attributes/panel_overdrive/current_value"
        ),
        "0"
    );
    let mux = knob(&found, Knob::GpuMux);
    assert_eq!(mux.describe(&sysfs)["pendingReboot"], json!(false));
    assert_eq!(mux.set(&sysfs, Value::U32(7)).ok(), Some(Value::U32(1)));
    assert!(mux.set(&sysfs, Value::U32(0)).is_ok());
    assert_eq!(mux.describe(&sysfs)["pendingReboot"], json!(true));
}

#[test]
fn the_keyboard_light_has_four_levels() {
    let (_tree, sysfs, found) = g14();
    let light = knob(&found, Knob::KbdBacklight);
    assert_eq!(
        light.describe(&sysfs),
        json!({"value": 0, "min": 0, "max": 3})
    );
    assert_eq!(light.set(&sysfs, Value::U32(9)).ok(), Some(Value::U32(3)));
}

#[test]
fn a_machine_without_the_files_has_no_knobs() {
    let tree = TempTree::empty();
    let sysfs = Sysfs::fake(&tree.path);
    assert!(discover(&sysfs, None).is_empty());
}
