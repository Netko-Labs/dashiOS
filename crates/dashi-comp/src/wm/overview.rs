//! The overview (Mission Control): the shell lays the windows out
//! (packages/shell/src/overview/plan.ts) and the compositor flies them there,
//! shows them small, and reports what the person does with them: a press on
//! one or on the background (`overview-pick`), a window starting to be
//! dragged (`overview-drag`) and where it was let go (`overview-drop`, over
//! the shell's Desktops row too), and keys (`overview-key`; not while a
//! shell surface holds the keyboard: those are its own). The shell decides
//! what each means; closing flies the windows back.

mod pointer;

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Point, Rectangle},
};

use super::{geometry::frame_of, windows::WindowId};
use crate::{
    ipc::protocol::{Event, OverviewParams},
    state::Dashi,
};

const OPENING: Duration = Duration::from_millis(220);
const CLOSING: Duration = Duration::from_millis(250);
/// A press that moves further than this is a drag.
const DRAG_START: f64 = 6.0;

pub(crate) struct Overview {
    /// Where each window goes (outer frames, global logical).
    targets: HashMap<WindowId, Rectangle<i32, Logical>>,
    /// Where each was when it opened.
    from: HashMap<WindowId, Rectangle<i32, Logical>>,
    /// 0 is the desktop, 1 is the overview.
    progress: f64,
    closing: bool,
    press: Option<Press>,
}

struct Press {
    window: Option<WindowId>,
    at: Point<f64, Logical>,
    dragging: bool,
}

impl Overview {
    fn dragged(&self) -> Option<WindowId> {
        self.press
            .as_ref()
            .filter(|press| press.dragging && !self.closing)
            .and_then(|press| press.window)
    }
}

fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

fn lerp(a: Rectangle<i32, Logical>, b: Rectangle<i32, Logical>, t: f64) -> Rectangle<f64, Logical> {
    let mix = |x: i32, y: i32| f64::from(x) + (f64::from(y) - f64::from(x)) * t;
    Rectangle::new(
        (mix(a.loc.x, b.loc.x), mix(a.loc.y, b.loc.y)).into(),
        (mix(a.size.w, b.size.w), mix(a.size.h, b.size.h)).into(),
    )
}

impl Dashi {
    pub(crate) fn overview_open(&self) -> bool {
        self.overview.as_ref().is_some_and(|o| !o.closing)
    }

    /// `overview {windows}` opens it or lays it out again; `overview {duration?}` closes it.
    pub(crate) fn overview_request(&mut self, params: &OverviewParams) -> Result<(), String> {
        let Some(plan) = &params.windows else {
            let duration = params
                .duration
                .map(|ms| Duration::from_millis(ms.to::<u64>()));
            self.close_overview(duration.unwrap_or(CLOSING).min(Duration::from_secs(2)));
            return Ok(());
        };
        // It would take presses on the lock screen (session/lock.rs).
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        let mut targets = HashMap::new();
        for placed in plan {
            let id = placed.id.to::<u64>();
            let rect = placed.rect.positive().ok_or("each window needs a rect")?;
            if self.windows.get(id).is_some_and(|e| e.announced) {
                targets.insert(id, rect);
            }
        }
        let from: HashMap<_, _> = targets
            .keys()
            .filter_map(|id| {
                self.windows
                    .get(*id)
                    .and_then(|e| frame_of(self, &e.window))
                    .map(|frame| (*id, frame))
            })
            .collect();
        let opening = !self.overview_open();
        let progress = if opening {
            0.0
        } else {
            self.overview.as_ref().map_or(1.0, |o| o.progress)
        };
        self.overview = Some(Overview {
            targets,
            from,
            progress,
            closing: false,
            press: None,
        });
        if opening {
            self.ipc.emit(Event::Overview { active: true });
            self.animate_overview(OPENING, false);
        }
        Ok(())
    }

    fn close_overview(&mut self, duration: Duration) {
        let Some(overview) = self.overview.as_mut() else {
            return;
        };
        if overview.closing {
            return;
        }
        overview.closing = true;
        overview.press = None;
        self.ipc.emit(Event::Overview { active: false });
        if duration.is_zero() || self.chrome_style.reduce_motion {
            self.overview = None;
        } else {
            self.animate_overview(duration, true);
        }
    }

    fn animate_overview(&mut self, length: Duration, closing: bool) {
        if self.chrome_style.reduce_motion {
            if let Some(overview) = self.overview.as_mut() {
                overview.progress = 1.0;
            }
            return;
        }
        let start = self.overview.as_ref().map_or(0.0, |o| o.progress);
        let began = Instant::now();
        let frame = Duration::from_millis(8);
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(frame), move |_, _, state| {
                let Some(overview) = state.overview.as_mut() else {
                    return TimeoutAction::Drop;
                };
                if overview.closing != closing {
                    return TimeoutAction::Drop;
                }
                let t = ease(began.elapsed().as_secs_f64() / length.as_secs_f64());
                overview.progress = if closing {
                    start * (1.0 - t)
                } else {
                    start + (1.0 - start) * t
                };
                if t < 1.0 {
                    return TimeoutAction::ToDuration(frame);
                }
                if closing {
                    state.overview = None;
                }
                TimeoutAction::Drop
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pressed(window: Option<WindowId>, dragging: bool, closing: bool) -> Overview {
        Overview {
            targets: HashMap::new(),
            from: HashMap::new(),
            progress: 1.0,
            closing,
            press: Some(Press {
                window,
                at: (0.0, 0.0).into(),
                dragging,
            }),
        }
    }

    #[test]
    fn only_a_window_dragged_in_the_open_overview_goes_in_front() {
        assert_eq!(pressed(Some(3), true, false).dragged(), Some(3));
        assert_eq!(
            pressed(Some(3), false, false).dragged(),
            None,
            "pressed, not dragged yet"
        );
        assert_eq!(pressed(None, true, false).dragged(), None, "the background");
        assert_eq!(
            pressed(Some(3), true, true).dragged(),
            None,
            "closing: back in its place"
        );
    }

    fn parse_rect(value: &serde_json::Value) -> Option<Rectangle<i32, Logical>> {
        crate::ipc::protocol::read::<crate::ipc::protocol::Rect>(value.clone())
            .ok()?
            .positive()
    }

    #[test]
    fn rects_are_checked() {
        assert!(
            parse_rect(&serde_json::json!({ "x": 10, "y": 20, "width": 300, "height": 200 }))
                .is_some()
        );
        assert!(
            parse_rect(&serde_json::json!({ "x": 10, "y": 20, "width": 0, "height": 200 }))
                .is_none()
        );
        assert!(parse_rect(&serde_json::json!({ "x": 10, "y": 20 })).is_none());
    }

    #[test]
    fn flights_go_from_the_frame_to_the_place() {
        let a = Rectangle::new((0, 0).into(), (100, 100).into());
        let b = Rectangle::new((100, 50).into(), (50, 50).into());
        assert_eq!(lerp(a, b, 0.0), a.to_f64());
        assert_eq!(lerp(a, b, 1.0), b.to_f64());
        assert_eq!(lerp(a, b, 0.5).size.w, 75.0);
    }
}
