//! Nested: the compositor in a window of another Wayland or X11 session.
//! Adapted from smithay's smallvil and anvil examples (MIT,
//! github.com/Smithay/smithay, v0.7.0).

use std::time::Duration;

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
        wayland_protocols::wp::presentation_time::server::wp_presentation_feedback,
        winit::{dpi::LogicalSize, window::WindowAttributes},
    },
    utils::{Clock, Monotonic, Rectangle, Transform},
    wayland::{dmabuf::DmabufFeedbackBuilder, presentation::Refresh},
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

    if let Some(size) = std::env::var("DASHI_NESTED_SCREEN")
        .ok()
        .as_deref()
        .and_then(virtual_size)
    {
        add_virtual_screen(handle, state, size, backend.window_size().w)?;
    }

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
                .map(|result| state.after_render(&output, &result.states, None))
                .map_err(|error| format!("{error:?}"))
        }
        Err(error) => Err(error.to_string()),
    };
    match rendered {
        Ok(mut feedback) => match data.backend.submit(Some(&[Rectangle::from_size(size)])) {
            // Nested, there is no vblank to wait for: shown is as good as submitted.
            Ok(()) => {
                let refresh = output
                    .current_mode()
                    .map(|mode| mode.refresh)
                    .filter(|mhz| *mhz > 0)
                    .map(|mhz| Duration::from_secs_f64(1_000.0 / f64::from(mhz)));
                let refresh = refresh.map_or(Refresh::Unknown, Refresh::fixed);
                let now = Clock::<Monotonic>::new().now();
                feedback.presented(now, refresh, 0, wp_presentation_feedback::Kind::empty());
            }
            Err(error) => {
                feedback.discarded();
                tracing::warn!(%error, "presenting the nested frame");
            }
        },
        Err(error) => tracing::warn!(%error, "drawing the nested frame"),
    }
    data.backend.window().request_redraw();
    state.backend = Backend::Winit(data);
    state.send_frames(&output);
}

/// `DASHI_NESTED_SCREEN=1920x1080`: a size for the nested session's second screen.
fn virtual_size(text: &str) -> Option<smithay::utils::Size<i32, smithay::utils::Physical>> {
    let (w, h) = text.trim().split_once('x')?;
    let (w, h) = (w.parse::<i32>().ok()?, h.parse::<i32>().ok()?);
    ((320..=7680).contains(&w) && (240..=4320).contains(&h)).then(|| (w, h).into())
}

/// A second screen for the nested session, beside the window (`DASHI_NESTED_SCREEN`):
/// never drawn on its own, its clients paced by a timer as headless's are. It
/// is there for what needs two screens (mirroring, the arrangement), seen
/// through `capture {output}` or by mirroring it into the window.
fn add_virtual_screen(
    handle: &LoopHandle<'static, Dashi>,
    state: &mut Dashi,
    size: smithay::utils::Size<i32, smithay::utils::Physical>,
    beside: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    use smithay::reexports::calloop::timer::{TimeoutAction, Timer};
    let output = Output::new(
        "Virtual-1".to_string(),
        PhysicalProperties {
            size: (0, 0).into(),
            subpixel: Subpixel::Unknown,
            make: "Dashi".into(),
            model: "Virtual".into(),
        },
    );
    let mode = Mode {
        size,
        refresh: 60_000,
    };
    let _global = output.create_global::<Dashi>(&state.display_handle);
    output.change_current_state(
        Some(mode),
        Some(Transform::Normal),
        None,
        Some((beside, 0).into()),
    );
    output.set_preferred(mode);
    state.space.map_output(&output, (beside, 0));
    let frame = Duration::from_millis(16);
    handle.insert_source(Timer::from_duration(frame), move |_, _, state| {
        state.send_frames(&output);
        TimeoutAction::ToDuration(frame)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_nested_second_screen_is_a_size_in_range() {
        assert_eq!(virtual_size("1920x1080"), Some((1920, 1080).into()));
        assert_eq!(virtual_size(" 1280x1024 "), Some((1280, 1024).into()));
        for bad in [
            "",
            "1920",
            "1920x",
            "x1080",
            "0x0",
            "99999x1080",
            "1920*1080",
            "-1x5",
        ] {
            assert_eq!(virtual_size(bad), None, "{bad}");
        }
    }
}
