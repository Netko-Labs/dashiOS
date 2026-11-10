//! The IPC's one definition on the Rust side (docs/compositor-ipc.md): each
//! method's params and reply are types beside the method (`methods/`, or the
//! module whose params they are), every event is a variant of `Event`, and
//! numbers are refused out of range as they are read. `cargo test` writes one
//! example of each to `test/fixtures/ipc/`, and the shell's tests parse them
//! with its shapes (H9).

mod events;
mod make;
mod numbers;
mod output;
mod pictures;
mod read;
mod window;

pub(crate) use events::{
    Bottom, Control, Event, Grab, Placing, Position, ScreenEdge, SuperPhase, Swipe, SwipePhase,
};
pub(crate) use make::Asked;
pub(crate) use numbers::{Coord, Count, Finite, Int, Millis, Pid, Real, Wide, WindowId};
pub(crate) use output::{Gpu, Gpus, Mode, ModeInfo, Output, Outputs, Rotation, Vrr};
pub(crate) use pictures::{
    OverviewParams, SpacePreviews, SpacesAnswer, WallpaperParams, WindowThumbnails,
};
pub(crate) use read::{Done, Nothing, read, write};
pub(crate) use window::{At, Extent, Frame, Icon, Rect, State, Window};
