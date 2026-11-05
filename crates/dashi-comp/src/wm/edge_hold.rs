//! A held window against a screen edge (`edge-hold`): while a window is
//! dragged, the pointer resting on a screen's edge for 400 ms is told to the
//! shell, and again every 400 ms it stays there. What a hold does (go to the
//! next Desktop, or nothing: a screen beyond that edge, a tile preview
//! showing) is the shell's (packages/shell/src/spaces/edge.ts).
//!
//! Pushing on past the edge (the pointer held there, still moving outward)
//! is not resting: a tile zone there waits again (zones.rs), so a push
//! carries the window on and a rest tiles it.

use std::time::{Duration, Instant};

use serde_json::json;
use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Point, Rectangle},
};

use crate::state::Dashi;

/// How long the window rests against an edge before the shell hears of it.
pub(crate) const HOLD: Duration = Duration::from_millis(400);
/// How close to the edge counts as against it (the pointer stops one pixel short).
const NEAR: f64 = 1.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Edge {
    Left,
    Right,
    Top,
    Bottom,
}

impl Edge {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Edge::Left => "left",
            Edge::Right => "right",
            Edge::Top => "top",
            Edge::Bottom => "bottom",
        }
    }

    /// Whether a move by `delta` pushes out through this edge.
    pub(crate) fn outward(self, delta: Point<f64, Logical>) -> bool {
        match self {
            Edge::Left => delta.x < 0.0,
            Edge::Right => delta.x > 0.0,
            Edge::Top => delta.y < 0.0,
            Edge::Bottom => delta.y > 0.0,
        }
    }
}

/// The edge of `screen` the pointer at `at` is against; the sides before the top and bottom.
pub(crate) fn edge_of(at: Point<f64, Logical>, screen: Rectangle<i32, Logical>) -> Option<Edge> {
    let g = screen.to_f64();
    if !g.contains(at) {
        return None;
    }
    if at.x < g.loc.x + NEAR {
        Some(Edge::Left)
    } else if at.x >= g.loc.x + g.size.w - NEAR {
        Some(Edge::Right)
    } else if at.y < g.loc.y + NEAR {
        Some(Edge::Top)
    } else if at.y >= g.loc.y + g.size.h - NEAR {
        Some(Edge::Bottom)
    } else {
        None
    }
}

/// Where the hold is: an edge of a screen (by name), since when, and how often it was told.
#[derive(Default)]
pub(crate) struct EdgeHold {
    at: Option<(Edge, String, Instant)>,
    count: u32,
}

impl EdgeHold {
    /// The held window's pointer is against `edge` now (None: no edge).
    /// Some(since) when a new hold starts, for its timer.
    pub(crate) fn moved(&mut self, edge: Option<(Edge, String)>, now: Instant) -> Option<Instant> {
        match (&self.at, edge) {
            (Some((was, on, _)), Some((edge, output))) if *was == edge && *on == output => None,
            (_, Some((edge, output))) => {
                self.at = Some((edge, output, now));
                self.count = 0;
                Some(now)
            }
            (_, None) => {
                self.end();
                None
            }
        }
    }

    /// The timer of the hold that began at `since` ran out: what to tell
    /// (the edge, the screen, and the how-manieth time), while that hold lasts.
    pub(crate) fn due(&mut self, since: Instant) -> Option<(Edge, String, u32)> {
        let (edge, output, began) = self.at.as_ref()?;
        if *began != since {
            return None;
        }
        self.count += 1;
        Some((*edge, output.clone(), self.count))
    }

    /// The edge the hold is on, if any.
    pub(crate) fn edge(&self) -> Option<Edge> {
        self.at.as_ref().map(|(edge, _, _)| *edge)
    }

    pub(crate) fn end(&mut self) {
        self.at = None;
        self.count = 0;
    }
}

impl Dashi {
    /// A held window's pointer moved to `at`: a hold starts, goes on, or ends.
    pub(crate) fn edge_watch(&mut self, at: Point<f64, Logical>) {
        let edge = self.space.output_under(at).next().and_then(|output| {
            let screen = self.space.output_geometry(output)?;
            Some((edge_of(at, screen)?, output.name()))
        });
        let Some(since) = self.edge_hold.moved(edge, Instant::now()) else {
            return;
        };
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(HOLD), move |_, _, state| {
                let Some(window) = state.held else {
                    state.edge_hold.end();
                    return TimeoutAction::Drop;
                };
                let Some((edge, output, count)) = state.edge_hold.due(since) else {
                    return TimeoutAction::Drop;
                };
                let preview = state.zones.preview.is_some();
                state.ipc.emit(
                    "edge-hold",
                    json!({ "edge": edge.name(), "output": output, "window": window, "count": count, "preview": preview }),
                );
                TimeoutAction::ToDuration(HOLD)
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen() -> Rectangle<i32, Logical> {
        Rectangle::new((1920, 0).into(), (1920, 1080).into())
    }

    #[test]
    fn the_pointer_is_against_an_edge_only_at_it() {
        assert_eq!(edge_of((1920.0, 500.0).into(), screen()), Some(Edge::Left));
        assert_eq!(edge_of((3839.0, 500.0).into(), screen()), Some(Edge::Right));
        assert_eq!(edge_of((2500.0, 0.0).into(), screen()), Some(Edge::Top));
        assert_eq!(
            edge_of((2500.0, 1079.5).into(), screen()),
            Some(Edge::Bottom)
        );
        assert_eq!(
            edge_of((1920.0, 0.0).into(), screen()),
            Some(Edge::Left),
            "a corner is its side"
        );
        assert_eq!(edge_of((1922.0, 500.0).into(), screen()), None);
        assert_eq!(
            edge_of((100.0, 500.0).into(), screen()),
            None,
            "another screen"
        );
    }

    #[test]
    fn a_push_goes_out_through_the_edge() {
        assert!(Edge::Left.outward((-3.0, 0.0).into()));
        assert!(!Edge::Left.outward((3.0, -9.0).into()));
        assert!(Edge::Bottom.outward((0.0, 1.0).into()));
    }

    #[test]
    fn a_hold_is_timed_from_arriving_and_told_while_it_lasts() {
        let mut hold = EdgeHold::default();
        let t0 = Instant::now();
        let since = hold
            .moved(Some((Edge::Right, "DP-1".into())), t0)
            .expect("arriving starts a hold");
        // Moving along the same edge keeps it.
        assert_eq!(
            hold.moved(Some((Edge::Right, "DP-1".into())), t0 + HOLD / 2),
            None
        );
        assert_eq!(hold.due(since), Some((Edge::Right, "DP-1".into(), 1)));
        assert_eq!(
            hold.due(since),
            Some((Edge::Right, "DP-1".into(), 2)),
            "told again while held"
        );
        assert_eq!(hold.edge(), Some(Edge::Right));

        // Away from the edge: the old timer finds nothing.
        assert_eq!(hold.moved(None, t0 + HOLD), None);
        assert_eq!(hold.due(since), None);

        // Back again, or to another edge: a new hold, counted afresh; the old timer is stale.
        let again = hold
            .moved(Some((Edge::Left, "DP-1".into())), t0 + HOLD * 2)
            .expect("a new hold");
        assert_eq!(hold.due(since), None);
        assert_eq!(hold.due(again), Some((Edge::Left, "DP-1".into(), 1)));
        let other = hold.moved(Some((Edge::Left, "HDMI-A-1".into())), t0 + HOLD * 3);
        assert!(
            other.is_some(),
            "the same edge of another screen is another hold"
        );
        hold.end();
        assert_eq!(hold.edge(), None);
    }
}
