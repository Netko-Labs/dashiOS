//! Windows flying to and from their Dock tile: minimize shrinks a window into
//! its tile (`animation-target` says where tiles are), and bringing it back
//! grows it out again. With Reduce Motion, or without a tile, they just go.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use serde_json::{Map, Value};
use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Rectangle},
};

use super::windows::WindowId;
use crate::state::Dashi;

const FLIGHT: Duration = Duration::from_millis(300);

/// A window on its way between two frames.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Flight {
    pub from: Rectangle<i32, Logical>,
    pub to: Rectangle<i32, Logical>,
    pub started: Instant,
}

impl Flight {
    /// Where it is now (eased), and whether it has arrived.
    pub(crate) fn now(&self) -> (Rectangle<f64, Logical>, bool) {
        let t = (self.started.elapsed().as_secs_f64() / FLIGHT.as_secs_f64()).clamp(0.0, 1.0);
        let e = 1.0 - (1.0 - t).powi(3);
        let mix = |a: i32, b: i32| f64::from(a) + (f64::from(b) - f64::from(a)) * e;
        let rect = Rectangle::new(
            (
                mix(self.from.loc.x, self.to.loc.x),
                mix(self.from.loc.y, self.to.loc.y),
            )
                .into(),
            (
                mix(self.from.size.w, self.to.size.w),
                mix(self.from.size.h, self.to.size.h),
            )
                .into(),
        );
        (rect, t >= 1.0)
    }
}

#[derive(Default)]
pub(crate) struct Motion {
    /// Each window's Dock tile (global logical).
    pub targets: HashMap<WindowId, Rectangle<i32, Logical>>,
    pub flights: HashMap<WindowId, Flight>,
}

impl Dashi {
    /// `animation-target {targets: [{window, rect}]}`; a null rect forgets it.
    pub(crate) fn set_animation_targets(
        &mut self,
        params: &Map<String, Value>,
    ) -> Result<(), String> {
        let targets = params
            .get("targets")
            .and_then(Value::as_array)
            .ok_or("`targets` must be a list")?;
        for target in targets {
            let id = target
                .get("window")
                .and_then(Value::as_u64)
                .ok_or("each target needs a window")?;
            let rect = target.get("rect").filter(|r| !r.is_null()).and_then(|r| {
                let get = |k: &str| r.get(k).and_then(Value::as_f64).map(|v| v.round() as i32);
                Some(Rectangle::new(
                    (get("x")?, get("y")?).into(),
                    (get("width")?.max(1), get("height")?.max(1)).into(),
                ))
            });
            match rect {
                Some(rect) => self.motion.targets.insert(id, rect),
                None => self.motion.targets.remove(&id),
            };
        }
        Ok(())
    }

    /// Fly `id` between `from` and its tile (`into` true: into it). False when it just goes.
    pub(crate) fn fly(&mut self, id: WindowId, frame: Rectangle<i32, Logical>, into: bool) -> bool {
        let Some(tile) = self
            .motion
            .targets
            .get(&id)
            .copied()
            .filter(|_| !self.chrome_style.reduce_motion)
        else {
            return false;
        };
        let (from, to) = if into { (frame, tile) } else { (tile, frame) };
        self.motion.flights.insert(
            id,
            Flight {
                from,
                to,
                started: Instant::now(),
            },
        );
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(FLIGHT), move |_, _, state| {
                state.motion.flights.remove(&id);
                TimeoutAction::Drop
            });
        true
    }
}
