//! No screens drawn: one virtual output (more with `DASHI_HEADLESS_SCREENS`)
//! and frame callbacks on a timer, so
//! clients and the IPC run anywhere, a GPU or not (tests, CI).

use std::time::Duration;

use smithay::{
    output::{Mode, Output, PhysicalProperties, Subpixel},
    reexports::calloop::{
        LoopHandle,
        timer::{TimeoutAction, Timer},
    },
    utils::Transform,
};

use crate::state::Dashi;

const FRAME: Duration = Duration::from_millis(16);

pub(crate) fn init(
    handle: &LoopHandle<'static, Dashi>,
    state: &mut Dashi,
) -> Result<(), Box<dyn std::error::Error>> {
    // `DASHI_HEADLESS_SCREENS=2`: more screens side by side, 1280 × 1024 after the first (tests of two).
    let count = std::env::var("DASHI_HEADLESS_SCREENS")
        .ok()
        .and_then(|n| n.trim().parse::<i32>().ok())
        .unwrap_or(1)
        .clamp(1, 4);
    let mut outputs = Vec::new();
    let mut x = 0;
    for index in 1..=count {
        let size = if index == 1 {
            (1920, 1080)
        } else {
            (1280, 1024)
        };
        let output = Output::new(
            format!("HEADLESS-{index}"),
            PhysicalProperties {
                size: (0, 0).into(),
                subpixel: Subpixel::Unknown,
                make: "Dashi".into(),
                model: "Headless".into(),
            },
        );
        let mode = Mode {
            size: size.into(),
            refresh: 60_000,
        };
        let _global = output.create_global::<Dashi>(&state.display_handle);
        output.change_current_state(
            Some(mode),
            Some(Transform::Normal),
            None,
            Some((x, 0).into()),
        );
        output.set_preferred(mode);
        state.space.map_output(&output, (x, 0));
        x += size.0;
        outputs.push(output);
    }
    state.backend = super::Backend::Headless;

    let first = outputs[0].clone();
    handle.insert_source(Timer::from_duration(FRAME), move |_, _, state| {
        let elapsed = state.start_time.elapsed();
        state.space.elements().for_each(|window| {
            window.send_frame(&first, elapsed, Some(FRAME), |_, _| Some(first.clone()));
        });
        TimeoutAction::ToDuration(FRAME)
    })?;
    Ok(())
}
