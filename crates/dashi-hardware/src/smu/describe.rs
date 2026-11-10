//! The `CurveOptimizer()` method's JSON.

use serde_json::{Value, json};

use super::host::make_smn;
use super::optimizer::CurveOptimizer;
use crate::model::Model;
use crate::sysfs::Sysfs;

/// The `CurveOptimizer()` method's JSON (docs/hardware.md).
pub(crate) fn describe(
    sysfs: &Sysfs,
    model: Option<&Model>,
    all_core: i32,
    per_core_values: &[i32],
) -> Value {
    match CurveOptimizer::probe(sysfs, model, make_smn(sysfs)) {
        Ok((_, cap)) => json!({
            "available": true,
            "reason": "",
            "range": [cap.range.0, cap.range.1],
            "perCore": cap.per_core,
            "cores": cap.cores,
            "allCore": all_core,
            "perCoreValues": per_core_values,
        }),
        Err(reason) => json!({
            "available": false,
            "reason": reason.reason(),
            "range": [0, 0],
            "perCore": false,
            "cores": 0,
            "allCore": 0,
            "perCoreValues": [],
        }),
    }
}
