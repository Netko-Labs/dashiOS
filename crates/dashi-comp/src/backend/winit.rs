//! Nested: the compositor in a window of another Wayland or X11 session.
//! Adapted from smithay's smallvil and anvil examples (MIT,
//! github.com/Smithay/smithay, v0.7.0).

use smithay::{
    backend::{
        allocator::dmabuf::Dmabuf,
        egl::EGLDevice,
        renderer::{ImportDma, damage::OutputDamageTracker, gles::GlesRenderer},
        winit::{self, WinitEvent, WinitGraphicsBackend},
    },
    output::{Mode, Output, PhysicalProperties, Subpixel},
    reexports::{
        calloop::LoopHandle,
        winit::{dpi::LogicalSize, window::WindowAttributes},
    },
    utils::{Rectangle, Transform},
    wayland::dmabuf::DmabufFeedbackBuilder,
};

use super::{BACKGROUND, Backend};
use crate::{outputs::ShownTransform, render, state::Dashi};

pub(crate) struct WinitData {
    backend: WinitGraphicsBackend<GlesRenderer>,
    output: Output,
    damage_tracker: OutputDamageTracker,
}

impl WinitData {
    pub(crate) fn renderer(&mut self) -> &mut GlesRenderer {
        self.backend.renderer()
    }

    pub(crate) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        self.backend.renderer().import_dmabuf(dmabuf, None).is_ok()
    }
}

pub(crate) fn init(
    handle: &LoopHandle<'static, Dashi>,
    state: &mut Dashi,
) -> Result<(), Box<dyn std::error::Error>> {
    let attributes = WindowAttributes::default()
        .with_title("Dashi (nested)")
        .with_inner_size(LogicalSize::new(1280.0, 800.0));
    let (mut backend, winit) = winit::init_from_attributes::<GlesRenderer>(attributes)?;
    let mode = Mode {
        size: backend.window_size(),
        refresh: 60_000,
    };
    let output = Output::new(
        "winit".to_string(),
        PhysicalProperties {
            size: (0, 0).into(),
            subpixel: Subpixel::Unknown,
            make: "Dashi".into(),
            model: "Nested".into(),
        },
    );
    let _global = output.create_global::<Dashi>(&state.display_handle);
    // GL's origin is the bottom left: the nested window is drawn flipped.
    output.change_current_state(
        Some(mode),
        Some(Transform::Flipped180),
        None,
        Some((0, 0).into()),
    );
    output.set_preferred(mode);
    output
        .user_data()
        .insert_if_missing(|| ShownTransform(Transform::Normal));
    state.space.map_output(&output, (0, 0));

    advertise_dmabuf(state, &mut backend);
    let damage_tracker = OutputDamageTracker::from_output(&output);
    state.backend = Backend::Winit(Box::new(WinitData {
        backend,
        output,
        damage_tracker,
    }));

    handle.insert_source(winit, move |event, _, state| match event {
        WinitEvent::Resized { size, .. } => {
            if let Backend::Winit(data) = &state.backend {
                let output = data.output.clone();
                let mode = Mode {
                    size,
                    refresh: 60_000,
                };
                output.change_current_state(Some(mode), None, None, None);
                state.output_changed(&output);
            }
        }
        WinitEvent::Input(event) => state.process_input_event(event),
        WinitEvent::Redraw => redraw(state),
        WinitEvent::CloseRequested => state.loop_signal.stop(),
        _ => {}
    })?;
    Ok(())
}

/// GPU clients (Vulkan and GL, mirin's Metal host among them) hand over
/// buffers through linux-dmabuf: with feedback (v4) when the render node is
/// known, else the formats alone (v3).
fn advertise_dmabuf(state: &mut Dashi, backend: &mut WinitGraphicsBackend<GlesRenderer>) {
    let formats = backend.renderer().dmabuf_formats();
    let node = EGLDevice::device_for_display(backend.renderer().egl_context().display())
        .and_then(|device| device.try_get_render_node());
    let feedback = match node {
        Ok(Some(node)) => DmabufFeedbackBuilder::new(node.dev_id(), formats.clone())
            .build()
            .ok(),
        _ => None,
    };
    let dh = state.display_handle.clone();
    let global = match feedback {
        Some(feedback) => state
            .dmabuf_state
            .create_global_with_default_feedback::<Dashi>(&dh, &feedback),
        None => {
            tracing::warn!("no render node for dmabuf feedback; offering linux-dmabuf v3");
            state.dmabuf_state.create_global::<Dashi>(&dh, formats)
        }
    };
    state.dmabuf_global = Some(global);
}

fn redraw(state: &mut Dashi) {
    // The scene needs the whole state (title bar and cursor caches); the backend is put back after.
    let Backend::Winit(mut data) = std::mem::take(&mut state.backend) else {
        return;
    };
    let size = data.backend.window_size();
    let output = data.output.clone();
    let rendered = match data.backend.bind() {
        Ok((renderer, mut framebuffer)) => {
            // The host compositor draws the pointer over the nested window.
            let elements = render::output_elements(state, renderer, &output, false);
            data.damage_tracker
                .render_output(renderer, &mut framebuffer, 0, &elements, BACKGROUND)
                .map(|_| ())
                .map_err(|error| format!("{error:?}"))
        }
        Err(error) => Err(error.to_string()),
    };
    match rendered {
        Ok(()) => {
            if let Err(error) = data.backend.submit(Some(&[Rectangle::from_size(size)])) {
                tracing::warn!(%error, "presenting the nested frame");
            }
        }
        Err(error) => tracing::warn!(%error, "drawing the nested frame"),
    }
    data.backend.window().request_redraw();
    state.backend = Backend::Winit(data);
    state.send_frames(&output);
}
