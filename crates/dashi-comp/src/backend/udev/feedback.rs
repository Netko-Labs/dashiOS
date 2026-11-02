//! Per-surface dmabuf feedback: a surface a screen's plane shows directly
//! (direct scanout) hears a scanout tranche with the formats that plane takes,
//! so a full-screen game or video allocates buffers the display can show
//! without a copy; every other surface hears the drawing GPU's formats.

use smithay::{
    backend::{
        allocator::format::FormatSet,
        drm::{DrmNode, DrmSurface},
        renderer::ImportDma,
    },
    reexports::wayland_protocols::wp::linux_dmabuf::zv1::server::zwp_linux_dmabuf_feedback_v1::TrancheFlags,
    wayland::dmabuf::{DmabufFeedback, DmabufFeedbackBuilder},
};

use super::Gpus;

/// What a screen's surfaces hear: drawn by the GPU, or scanned out.
pub(crate) struct ScreenFeedback {
    pub render: DmabufFeedback,
    pub scanout: DmabufFeedback,
}

/// The feedback for a screen driven by `surface` (on `scanout_node`), drawn on `primary_gpu`.
pub(super) fn for_screen(
    gpus: &mut Gpus,
    primary_gpu: DrmNode,
    scanout_node: DrmNode,
    surface: &DrmSurface,
) -> Option<ScreenFeedback> {
    let render_formats = gpus.single_renderer(&primary_gpu).ok()?.dmabuf_formats();
    // Only formats the GPU can also draw from: a buffer a plane refuses still shows.
    let plane_formats: FormatSet = surface
        .plane_info()
        .formats
        .iter()
        .copied()
        .chain(
            surface
                .planes()
                .overlay
                .iter()
                .flat_map(|plane| plane.formats.iter().copied()),
        )
        .collect::<FormatSet>()
        .intersection(&render_formats)
        .copied()
        .collect();
    let builder = DmabufFeedbackBuilder::new(primary_gpu.dev_id(), render_formats.clone());
    let render = builder.clone().build().ok()?;
    let scanout = builder
        .add_preference_tranche(
            surface.device_fd().dev_id().ok()?,
            Some(TrancheFlags::Scanout),
            plane_formats,
        )
        .add_preference_tranche(scanout_node.dev_id(), None, render_formats)
        .build()
        .ok()?;
    Some(ScreenFeedback { render, scanout })
}
