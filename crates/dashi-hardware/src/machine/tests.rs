//! What a `SetMany` needs of polkit, on the captured G14.

use super::Machine;
use crate::knobs::{Action, Knob, Value};
use crate::sysfs::Sysfs;
use crate::sysfs::testing::TempTree;

fn g14(tree: &TempTree) -> Machine {
    let models = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/models");
    Machine::open(Sysfs::fake(&tree.path), &models)
}

#[test]
fn a_set_of_many_needs_the_strongest_action_any_knob_needs() {
    let tree = TempTree::fixture("ga403wr");
    let machine = g14(&tree);
    let epp = (Knob::Epp, Value::Str("performance".into()));
    let charge = (Knob::ChargeLimit, Value::U32(80));

    // Nothing, or everyday knobs only: everyday.
    assert_eq!(machine.action_for_many(&[]), Action::Everyday);
    assert_eq!(
        machine.action_for_many(&[epp.clone(), charge.clone()]),
        Action::Everyday
    );
    // A tune knob at a value no recipe gives needs Tune, whatever is beside it.
    let off_recipe = (Knob::PptSpl, Value::U32(81));
    assert_eq!(
        machine.action_for_many(&[charge.clone(), off_recipe]),
        Action::Tune
    );
    // A tune knob the model has no recipe for needs Tune beside a recipe's own.
    let recipe = (Knob::PptSpl, Value::U32(80));
    let outside = (Knob::NvTgp, Value::U32(80));
    assert_eq!(
        machine.action_for_many(&[epp.clone(), recipe.clone(), outside]),
        Action::Tune
    );
    // The model's own recipe column is a mode switch: everyday.
    assert_eq!(machine.action_for_many(&[epp, recipe]), Action::Everyday);
}
