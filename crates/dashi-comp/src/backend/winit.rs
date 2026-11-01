//! Nested: the compositor in a window of another Wayland or X11 session.
//! Adapted from smithay's smallvil example (MIT, github.com/Smithay/smithay, v0.7.0).

use std::time::Duration;

use smithay::{
    backend::{
        renderer::{
            damage::OutputDamageTracker, element::surface::WaylandSurfaceRenderElement,
            gles::GlesRenderer,
        },
        winit::{self, WinitEvent},
    },
    output::{Mode, Output, PhysicalProperties, Subpixel},
    reexports::{
        calloop::LoopHandle,
        winit::{dpi::LogicalSize, window::WindowAttributes},
    },
    utils::{Rectangle, Transform},
};

use super::BACKGROUND;
use crate::state::Dashi;

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
    state.space.map_output(&output, (0, 0));
    let mut damage_tracker = OutputDamageTracker::from_output(&output);

    handle.insert_source(winit, move |event, _, state| match event {
        WinitEvent::Resized { size, .. } => {
            output.change_current_state(
                Some(Mode {
                    size,
                    refresh: 60_000,
                }),
                None,
                None,
                None,
            );
        }
        WinitEvent::Input(event) => state.process_input_event(event),
        WinitEvent::Redraw => {
            let size = backend.window_size();
            let rendered = backend.bind().map_err(|error| error.to_string()).and_then(
                |(renderer, mut framebuffer)| {
                    smithay::desktop::space::render_output::<
                        _,
                        WaylandSurfaceRenderElement<GlesRenderer>,
                        _,
                        _,
                    >(
                        &output,
                        renderer,
                        &mut framebuffer,
                        1.0,
                        0,
                        [&state.space],
                        &[],
                        &mut damage_tracker,
                        BACKGROUND,
                    )
                    .map(|_| ())
                    .map_err(|error| error.to_string())
                },
            );
            match rendered {
                Ok(()) => {
                    if let Err(error) = backend.submit(Some(&[Rectangle::from_size(size)])) {
                        tracing::warn!(%error, "presenting the nested frame");
                    }
                }
                Err(error) => tracing::warn!(%error, "drawing the nested frame"),
            }
            let elapsed = state.start_time.elapsed();
            state.space.elements().for_each(|window| {
                window.send_frame(&output, elapsed, Some(Duration::ZERO), |_, _| {
                    Some(output.clone())
                });
            });
            backend.window().request_redraw();
        }
        WinitEvent::CloseRequested => state.loop_signal.stop(),
        _ => {}
    })?;
    Ok(())
}
