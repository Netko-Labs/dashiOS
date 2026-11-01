//! No screens drawn: one virtual output and frame callbacks on a timer, so
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
    let output = Output::new(
        "HEADLESS-1".to_string(),
        PhysicalProperties {
            size: (0, 0).into(),
            subpixel: Subpixel::Unknown,
            make: "Dashi".into(),
            model: "Headless".into(),
        },
    );
    let mode = Mode {
        size: (1920, 1080).into(),
        refresh: 60_000,
    };
    let _global = output.create_global::<Dashi>(&state.display_handle);
    output.change_current_state(
        Some(mode),
        Some(Transform::Normal),
        None,
        Some((0, 0).into()),
    );
    output.set_preferred(mode);
    state.space.map_output(&output, (0, 0));

    handle.insert_source(Timer::from_duration(FRAME), move |_, _, state| {
        let elapsed = state.start_time.elapsed();
        state.space.elements().for_each(|window| {
            window.send_frame(&output, elapsed, Some(FRAME), |_, _| Some(output.clone()));
        });
        TimeoutAction::ToDuration(FRAME)
    })?;
    Ok(())
}
