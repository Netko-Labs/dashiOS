//! The Curve Optimizer against the simulated SMU and the G14 fixture tree.

use serde_json::json;

use super::describe::describe;
use super::host::{core_count, kernel_lockdown};
use super::optimizer::{CurveOptimizer, Unavailable};
use super::smn::{SimSmu, Smn};
use crate::model::Model;
use crate::sysfs::Sysfs;
use crate::sysfs::testing::TempTree;

fn g14_model() -> Model {
    Model::parse(include_str!("../../../../data/models/GA403WR.json")).expect("parses")
}

fn sim() -> Box<dyn Smn> {
    Box::new(SimSmu::new())
}

#[test]
fn available_on_the_simulated_g14_and_offsets_land() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let model = g14_model();
    let (mut co, cap) = match CurveOptimizer::probe(&sysfs, Some(&model), sim()) {
        Ok(result) => result,
        // CPUID on the build host may not be Strix Point.
        Err(Unavailable::UnsupportedCpu) => return,
        Err(other) => panic!("unexpected: {other:?}"),
    };
    assert_eq!(cap.range, (-40, 0));
    assert!(cap.per_core);
    assert!(co.set_all_core(-5).is_ok());
    assert!(co.set_per_core(0, -10).is_ok());
    assert!(co.set_per_core(999, -5).is_err());
}

#[test]
fn lockdown_blocks_it() {
    let tree = TempTree::fixture("ga403wr");
    tree.file(
        "kernel/security/lockdown",
        "none [integrity] confidentiality",
    );
    let sysfs = Sysfs::fake(&tree.path);
    assert!(kernel_lockdown(&sysfs));
    let result = CurveOptimizer::probe(&sysfs, Some(&g14_model()), sim());
    assert!(matches!(
        result,
        Err(Unavailable::Lockdown) | Err(Unavailable::UnsupportedCpu)
    ));
}

#[test]
fn a_model_without_undervolt_is_not_in_the_database() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let model = Model::parse(r#"{"id":"X","name":"X","match":{"board_name":"GA403WR"}}"#).unwrap();
    assert_eq!(
        CurveOptimizer::probe(&sysfs, Some(&model), sim()).err(),
        Some(Unavailable::NotInDatabase)
    );
}

#[test]
fn describe_is_unavailable_without_a_model() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    let value = describe(&sysfs, None, 0, &[]);
    assert_eq!(value["available"], json!(false));
    assert_eq!(value["reason"], json!("not-in-database"));
}

#[test]
fn the_core_count_is_read_from_topology() {
    let tree = TempTree::fixture("ga403wr");
    let sysfs = Sysfs::fake(&tree.path);
    // The G14's HX 370 has 12 physical cores (24 threads).
    assert_eq!(core_count(&sysfs), 12);
}
