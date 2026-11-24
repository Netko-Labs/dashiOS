//! A drawn frame on its way to the display: the GPUs' fence, the commit, and
//! what a refusal does (planes.rs).
//!
//! The commit carries the frame's fence (`IN_FENCE_FD`) so the display shows
//! it once the GPUs are done, without the loop waiting. When it cannot (a
//! driver without the property, NVIDIA before 560.35.3, or a fence that
//! can't be exported), smithay leaves the wait to the caller
//! (`needs_sync`): the loop waits for the fence then, rather than show a
//! picture still being drawn (D512).

use std::os::fd::OwnedFd;

use smithay::backend::{
    allocator::Buffer,
    drm::{
        Framebuffer,
        compositor::{PrimaryPlaneElement, RenderFrameResult},
    },
    renderer::element::Element,
};

use super::frame::{Turn, monotonic_now};
use super::*;
use planes::Used;

/// Queue a frame `result` drew from `elements`, started at `started`.
/// `measure`: hand back its fence, to time the GPUs (report.rs).
pub(super) fn queue<B: Buffer, F: Framebuffer, E: Element>(
    state: &Dashi,
    screen: &mut Screen,
    output: &Output,
    elements: &[E],
    result: RenderFrameResult<'_, B, F, E>,
    measure: bool,
) -> Turn {
    let used = Used::of(&result);
    let fence = settle_sync(screen, &result, measure);
    let feedback = state.after_render(
        output,
        &result.states,
        screen.feedback.as_ref().map(|f| (&f.render, &f.scanout)),
    );
    let at = monotonic_now();
    match screen.scanout.queue_frame(Some(feedback)) {
        Ok(()) => {
            let frame = screen.stats.queued(at, monotonic_now().saturating_sub(at));
            if let Some(recovered) = screen.planes.taken(at) {
                planes::tell_recovered(output, &recovered);
            }
            Turn::Queued {
                watch: screen.flip.queue(at),
                fence: fence.map(|fence| (frame, fence)),
            }
        }
        Err(error) if planes::refused(&error) => {
            screen.stats.failed();
            let refusal = screen.planes.refused(at, used, planes::scene(elements));
            planes::tell_refused(output, &refusal, used, &error);
            Turn::Refused
        }
        // Waiting out a stalled flip, the commits fail (busy) each frame: once is enough.
        Err(error) if screen.flip.is_stalled() => {
            tracing::debug!(?error, "queueing a frame");
            Turn::Idle
        }
        Err(error) => {
            screen.stats.failed();
            tracing::warn!(?error, "queueing a frame");
            Turn::Idle
        }
    }
}

/// Wait for the GPUs here when the commit can't (`needs_sync`); the frame's
/// fence when `measure` asks for it.
fn settle_sync<B: Buffer, F: Framebuffer, E>(
    screen: &mut Screen,
    result: &RenderFrameResult<'_, B, F, E>,
    measure: bool,
) -> Option<OwnedFd> {
    let PrimaryPlaneElement::Swapchain(element) = &result.primary_element else {
        return None;
    };
    if result.needs_sync() {
        screen.stats.waited();
        if let Err(error) = element.sync.wait() {
            tracing::debug!(?error, "waiting for a frame's fence");
        }
        return None;
    }
    measure.then(|| element.sync.export()).flatten()
}

/// Time the GPUs on frame `frame`: its fence (a sync_file) turns readable
/// when it signals. Heard on the event loop, never waited for.
pub(super) fn watch_fence(
    state: &mut Dashi,
    node: DrmNode,
    crtc: crtc::Handle,
    frame: u64,
    fence: OwnedFd,
) {
    use smithay::reexports::calloop::{Interest, Mode, PostAction, generic::Generic};
    let source = Generic::new(fence, Interest::READ, Mode::OneShot);
    let inserted = state.loop_handle.insert_source(source, move |_, _, state| {
        state.wakes.frame_turn();
        let now = monotonic_now();
        with_udev(state, |_, data| {
            if let Some(screen) = data
                .devices
                .get_mut(&node)
                .and_then(|d| d.screens.get_mut(&crtc))
            {
                screen.stats.gpu_done(frame, now);
            }
        });
        Ok(PostAction::Remove)
    });
    if let Err(error) = inserted {
        tracing::debug!(%error, "timing a frame's fence");
    }
}
