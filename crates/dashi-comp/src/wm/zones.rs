//! Drag-to-tile (`layout {zones, dwellMs}`): while a window is dragged, the
//! pointer resting in a zone the shell drew (a screen edge, a corner, the
//! menu bar) shows where the window would go; letting go there tiles it.
//! Where the zones are and what each tiles to is the shell's (arrange.ts).

use std::time::{Duration, Instant};

use serde_json::{Map, Value};
use smithay::{
    desktop::Window,
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Point, Rectangle},
};

use crate::state::Dashi;

#[derive(Default)]
pub(crate) struct Zones {
    zones: Vec<(Rectangle<i32, Logical>, Rectangle<i32, Logical>)>,
    dwell: Duration,
    /// The zone the pointer is in, and since when.
    current: Option<(usize, Instant)>,
    /// Where the window would go: shown while the pointer rests in a zone.
    pub preview: Option<Rectangle<i32, Logical>>,
}

fn rect(value: &Value) -> Option<Rectangle<i32, Logical>> {
    let get = |k: &str| {
        value
            .get(k)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .map(|v| v.round() as i32)
    };
    let (x, y, w, h) = (get("x")?, get("y")?, get("width")?, get("height")?);
    (w > 0 && h > 0).then(|| Rectangle::new((x, y).into(), (w, h).into()))
}

impl Dashi {
    /// `layout {zones: [{area, frame}], dwellMs}`.
    pub(crate) fn set_zones(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let list = params
            .get("zones")
            .and_then(Value::as_array)
            .ok_or("`zones` must be a list")?;
        let zones = list
            .iter()
            .map(|zone| Some((rect(zone.get("area")?)?, rect(zone.get("frame")?)?)))
            .collect::<Option<Vec<_>>>()
            .ok_or("each zone needs an area and a frame")?;
        let dwell = params
            .get("dwellMs")
            .and_then(Value::as_u64)
            .unwrap_or(300)
            .min(5_000);
        self.zones = Zones {
            zones,
            dwell: Duration::from_millis(dwell),
            current: None,
            preview: None,
        };
        Ok(())
    }

    /// A dragged window moved: entering a zone starts its wait, leaving it ends the preview.
    pub(crate) fn drag_moved(&mut self, at: Point<f64, Logical>) {
        let zone = self
            .zones
            .zones
            .iter()
            .position(|(area, _)| area.to_f64().contains(at));
        if zone == self.zones.current.map(|(index, _)| index) {
            return;
        }
        self.zones.preview = None;
        self.zones.current = None;
        if let Some(index) = zone {
            self.zone_wait(index);
        }
    }

    /// The pointer pushed on out through the screen's edge (edge_hold.rs): not
    /// resting, so the zone it is in waits again and shows no preview meanwhile.
    pub(crate) fn drag_pushed(&mut self) {
        if let Some((index, _)) = self.zones.current {
            self.zones.preview = None;
            self.zone_wait(index);
        }
    }

    /// Wait in zone `index` from now; its preview shows if the pointer is still resting there then.
    fn zone_wait(&mut self, index: usize) {
        let since = Instant::now();
        self.zones.current = Some((index, since));
        let _ = self.loop_handle.insert_source(
            Timer::from_duration(self.zones.dwell),
            move |_, _, state| {
                if state.zones.current == Some((index, since)) {
                    state.zones.preview = state.zones.zones.get(index).map(|(_, frame)| *frame);
                }
                TimeoutAction::Drop
            },
        );
    }

    /// The drag ended: over a shown preview, the window takes that frame (and can be restored).
    pub(crate) fn drag_released(&mut self, window: &Window) {
        let preview = self.zones.preview.take();
        self.zones.current = None;
        let (Some(frame), Some(id)) = (preview, self.windows.by_window(window).map(|e| e.id))
        else {
            return;
        };
        if let Err(error) = self.frame_window(id, frame, true, false) {
            tracing::debug!(%error, "tiling a dragged window");
        }
    }
}
