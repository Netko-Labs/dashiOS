//! A GPU that does not draw, gone while open: abandoned, not closed.

use crate::ipc::protocol::Event;
use std::mem::{self, ManuallyDrop};

use smithay::backend::{egl::EGLContext, renderer::multigpu::ApiDevice};

use super::*;

/// An open GPU is gone (udev removed it, or its sysfs entry went). Every
/// call on a card that fell off the bus may hang in the driver (pciehp "Link
/// Down", then nvidia-modeset waiting for GPU progress forever), and letting
/// a device go makes them: smithay restores its CRTCs and drops DRM master,
/// the renderer makes its EGL context current to delete its objects, the
/// seat asks logind to close it. So none of that happens on the event loop:
/// its screens leave the compositor (Wayland state only), its event source
/// is removed, its renderer is leaked on purpose (`forsake_renderer`: GL
/// lives on this thread), the seat is not asked (logind hears the removal
/// itself), and the device with its scanouts and fd is dropped on a thread
/// of its own. The session goes on, on the GPU that draws.
pub(super) fn abandon(state: &mut Dashi, node: DrmNode, name: &str) {
    let device = with_udev(state, |_, data| {
        let device = data.devices.remove(&node)?;
        if let Some(render_node) = device.render_node {
            data.forsake_renderer(render_node);
        }
        Some(device)
    })
    .flatten();
    let Some(device) = device else { return };
    state.loop_handle.remove(device.token);
    let dh = state.display_handle.clone();
    for screen in device.screens.values() {
        tracing::info!(name = screen.output.name(), "screen removed with its GPU");
        state.space.unmap_output(&screen.output);
        state.mirror_output_gone(&screen.output);
        dh.remove_global::<Dashi>(screen.global.clone());
    }
    tracing::warn!(
        card = name,
        "an open GPU is gone: let go off the event loop (a call on it could hang in its driver)"
    );
    // Dropped on a thread of its own: on a card that fell off the bus,
    // smithay's restore and the DRM master drop hang that thread, not the
    // loop. If no thread starts, the device is leaked instead (ManuallyDrop).
    let device = ManuallyDrop::new(device);
    let _ = std::thread::Builder::new()
        .name("dashi-gpu-gone".into())
        .spawn(move || drop(ManuallyDrop::into_inner(device)));
    state.ipc.emit(Event::OutputsChanged);
    state.ipc.emit(Event::GpusChanged);
}

impl UdevData {
    /// Take a vanished GPU's renderer out of the GPU manager without
    /// dropping it (that would make its EGL context current and delete GL
    /// objects in a driver that may hang): a fresh renderer on the drawing
    /// GPU's display takes its place, and that is what the manager drops.
    /// Without one, the old renderer stays listed rather than dropped.
    fn forsake_renderer(&mut self, render_node: DrmNode) {
        let display = self
            .gpus
            .single_renderer(&self.primary_gpu)
            .ok()
            .map(|mut renderer| renderer.as_mut().egl_context().display().clone());
        let stand_in = display.and_then(|display| {
            let context = EGLContext::new(&display).ok()?;
            // SAFETY: the context was just created and is current on no thread.
            unsafe { GlesRenderer::new(context) }.ok()
        });
        let Some(stand_in) = stand_in else {
            tracing::warn!("no stand-in renderer: the gone GPU's renderer stays listed");
            return;
        };
        let swapped = match self.gpus.devices_mut() {
            Ok(mut devices) => devices
                .find(|device| *device.node() == render_node)
                .map(|device| mem::forget(mem::replace(device.renderer_mut(), stand_in)))
                .is_some(),
            Err(error) => {
                tracing::warn!(?error, "listing the GPUs");
                false
            }
        };
        if swapped {
            self.gpus.as_mut().remove_node(&render_node);
            if let Err(error) = self.gpus.devices().map(|_| ()) {
                tracing::warn!(?error, "listing the GPUs left");
            }
        }
    }
}
