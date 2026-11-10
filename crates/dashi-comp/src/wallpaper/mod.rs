//! What the desktop shows behind everything: a picture, a video, Dashi's
//! gradient, or one of the live looks (docs/compositor-ipc.md, `wallpaper`).
//! Pictures decode on a thread and videos play in GStreamer's, so neither
//! holds up a frame; the wallpaper that was there stays until the new one is
//! ready, then the shell hears `wallpaper {path, ok}`.

mod fit;
mod layer;
mod procedural;
mod set;
mod video;

pub(crate) use fit::Mode;
pub(crate) use layer::Wallpaper;
