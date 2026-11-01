//! Screens as the shell sees them (`outputs`), and the changes it asks for
//! (`output`). C2 adds whole arrangements (`outputs-config`).

mod report;

pub(crate) use report::{ShownTransform, describe_all, set_scale};
