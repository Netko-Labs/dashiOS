//! Which way a screen's picture reaches a GPU that shows it but did not
//! draw it (D510). smithay's multi-GPU renderer sets that way up on the
//! screen's first frame and says so in its log: "Found dma-copy set" (the
//! drawing GPU draws into a buffer both can read, the other copies it on its
//! own GPU) or "Falling back to cpu-copy" (each frame is read back to memory
//! and uploaded). This layer hears those two lines, and only those, on the
//! thread that draws; the frame that set the way up reads it after drawing.

use std::cell::Cell;

use tracing::{Event, Subscriber, field::Field};
use tracing_subscriber::{
    Layer,
    filter::{LevelFilter, Targets},
    layer::Context,
};

/// What smithay logs from (the multi-GPU renderer).
const TARGET: &str = "smithay::backend::renderer::multigpu";

/// How a screen's frames reach the GPU that shows them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum CopyPath {
    /// The GPU that draws them shows them.
    #[default]
    OneGpu,
    /// Drawn into a buffer the other GPU reads, and copied there by that GPU.
    GpuCopy,
    /// Read back to memory and uploaded to the other GPU, each frame.
    CpuCopy,
    /// Another GPU shows them, and smithay has not said how yet.
    Unknown,
}

impl CopyPath {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::OneGpu => "one-gpu",
            Self::GpuCopy => "gpu-copy",
            Self::CpuCopy => "cpu-copy",
            Self::Unknown => "unknown",
        }
    }
}

thread_local! {
    /// The way smithay last set up on this thread, until a frame takes it.
    static SEEN: Cell<Option<CopyPath>> = const { Cell::new(None) };
}

/// The way set up since the last call, on this thread (the event loop's).
pub(super) fn take_seen() -> Option<CopyPath> {
    SEEN.with(Cell::take)
}

/// The layer that hears it, filtered to smithay's multi-GPU lines at info and up.
pub(crate) fn layer<S>() -> impl Layer<S>
where
    S: Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    Hear.with_filter(Targets::new().with_target(TARGET, LevelFilter::INFO))
}

struct Hear;

impl<S: Subscriber> Layer<S> for Hear {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let mut message = Message(None);
        event.record(&mut message);
        if let Some(path) = message.0.as_deref().and_then(path_in) {
            SEEN.with(|seen| seen.set(Some(path)));
        }
    }
}

/// The way a line of smithay's names, if it names one.
fn path_in(message: &str) -> Option<CopyPath> {
    if message.starts_with("Found dma-copy set") {
        Some(CopyPath::GpuCopy)
    } else if message.starts_with("Falling back to cpu-copy") {
        Some(CopyPath::CpuCopy)
    } else {
        None
    }
}

struct Message(Option<String>);

impl tracing::field::Visit for Message {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.0 = Some(format!("{value:?}"));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" {
            self.0 = Some(value.to_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing_subscriber::layer::SubscriberExt;

    #[test]
    fn smithays_two_lines_name_the_way_and_nothing_else_does() {
        assert_eq!(
            path_in("Found dma-copy set for A <-> B: AB30@[Linear]"),
            Some(CopyPath::GpuCopy)
        );
        assert_eq!(
            path_in("Falling back to cpu-copy."),
            Some(CopyPath::CpuCopy)
        );
        assert_eq!(path_in("Error importing dmabuf from A to B"), None);
    }

    #[test]
    fn the_layer_hears_the_multi_gpu_renderer_only() {
        let subscriber = tracing_subscriber::registry().with(layer());
        tracing::subscriber::with_default(subscriber, || {
            assert_eq!(take_seen(), None);
            tracing::info!(target: "somewhere::else", "Found dma-copy set for A <-> B");
            assert_eq!(take_seen(), None);
            tracing::info!(target: TARGET, "Found dma-copy set for {:?} <-> {:?}", 1, 2);
            assert_eq!(take_seen(), Some(CopyPath::GpuCopy));
            assert_eq!(take_seen(), None, "a frame takes it once");
            tracing::info!(target: TARGET, "Falling back to cpu-copy.");
            assert_eq!(take_seen(), Some(CopyPath::CpuCopy));
            tracing::debug!(target: TARGET, "Falling back to cpu-copy.");
            assert_eq!(take_seen(), None, "below info is not heard");
        });
    }
}
