//! Spaces: every window belongs to one; only the current Space's windows are
//! on screen. The shell decides how many there are, when to switch, and where
//! windows go (packages/shell/src/spaces/); the compositor keeps each window's
//! Space and slides between them, following a swipe (`space-switch {progress}`).

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Point},
};

use super::windows::{Shown, WindowId};
use crate::state::Dashi;

pub(crate) const MAX_SPACES: usize = 16;
/// How long a switch slides.
const SLIDE: Duration = Duration::from_millis(250);

pub(crate) struct Spaces {
    pub count: usize,
    pub current: usize,
    /// Activating a window on another Space switches there (else the window comes here).
    pub follow: bool,
    /// A switch in progress: the windows of `from` and `to` drawn `at` (0–1) of the way.
    pub slide: Option<Slide>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Slide {
    pub from: usize,
    pub to: usize,
    pub at: f64,
}

impl Default for Spaces {
    fn default() -> Self {
        Self {
            count: 1,
            current: 0,
            follow: true,
            slide: None,
        }
    }
}

impl Spaces {
    pub(crate) fn answer(&self) -> Value {
        json!({ "count": self.count, "current": self.current })
    }
}

/// Eased progress for a slide's linear `t`.
fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

impl Dashi {
    /// Whether a window is on screen now: shown, and on the current Space.
    /// Window `id` goes along when the Space changes: held in a move grab, or carried (`space-switch {carry}`).
    pub(crate) fn goes_along(&self, id: WindowId) -> bool {
        self.held == Some(id) || self.carried == Some(id)
    }

    pub(crate) fn on_current_space(&self, id: WindowId) -> bool {
        self.windows
            .get(id)
            .is_some_and(|e| e.space == self.spaces.current)
    }

    /// `spaces {count?, follow?}`.
    pub(crate) fn configure_spaces(
        &mut self,
        count: Option<usize>,
        follow: Option<bool>,
    ) -> Result<Value, String> {
        if let Some(follow) = follow {
            self.spaces.follow = follow;
        }
        if let Some(count) = count {
            if !(1..=MAX_SPACES).contains(&count) {
                return Err(format!("`count` must be 1–{MAX_SPACES}"));
            }
            if self.spaces.current >= count {
                self.switch_space_now(count - 1);
            }
            // Windows on Spaces that go away join the last one left.
            let ids: Vec<WindowId> = self
                .windows
                .ids()
                .filter(|id| self.windows.get(*id).is_some_and(|e| e.space >= count))
                .collect();
            self.spaces.count = count;
            for id in ids {
                let _ = self.move_to_space(id, count - 1);
            }
            self.emit_space(self.spaces.current);
        }
        Ok(self.spaces.answer())
    }

    /// `space-switch {space, progress?, carry?}`: hold part of the way (a
    /// swipe), or go there, carrying window `carry` along if asked.
    pub(crate) fn switch_space(
        &mut self,
        target: usize,
        progress: Option<f64>,
        carry: Option<WindowId>,
    ) -> Result<Value, String> {
        if target >= self.spaces.count {
            return Err(format!("no Space {target}"));
        }
        if let Some(id) = carry {
            let shown = self
                .windows
                .get(id)
                .is_some_and(|e| e.announced && e.placed && e.shown == Shown::Normal);
            if !shown || !self.on_current_space(id) {
                return Err(format!("window {id} is not on the Space that shows"));
            }
            if progress.is_some() {
                return Err("`carry` goes with a whole switch, not `progress`".into());
            }
            self.carried = (target != self.spaces.current).then_some(id);
        }
        match progress {
            Some(at) => {
                let at = at.clamp(0.0, 1.0);
                if target != self.spaces.current {
                    self.spaces.slide = Some(Slide {
                        from: self.spaces.current,
                        to: target,
                        at,
                    });
                }
            }
            None => self.animate_to(target),
        }
        Ok(self.spaces.answer())
    }

    /// Finish at `target` from wherever a held slide is (or back to the current Space).
    fn animate_to(&mut self, target: usize) {
        let from = self.spaces.current;
        let (start, toward) = match self.spaces.slide {
            // Going back: the slide runs down from where it was held.
            Some(slide) if target == from => (slide.at, slide.to),
            Some(slide) if target == slide.to => (slide.at, target),
            _ => (0.0, target),
        };
        if toward == from || self.chrome_style.reduce_motion {
            self.spaces.slide = None;
            if target != from {
                self.switch_space_now(target);
            }
            return;
        }
        let back = target == from;
        self.spaces.slide = Some(Slide {
            from,
            to: toward,
            at: start,
        });
        let began = Instant::now();
        let remaining = if back { start } else { 1.0 - start };
        let length = SLIDE.mul_f64(remaining.max(0.2));
        let frame = Duration::from_millis(8);
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(frame), move |_, _, state| {
                let Some(slide) = state.spaces.slide.as_mut() else {
                    return TimeoutAction::Drop;
                };
                let t = ease(began.elapsed().as_secs_f64() / length.as_secs_f64());
                slide.at = if back {
                    start * (1.0 - t)
                } else {
                    start + (1.0 - start) * t
                };
                if t < 1.0 {
                    return TimeoutAction::ToDuration(frame);
                }
                // Where it ends is read back: a Space added meanwhile moves it up one.
                let toward = slide.to;
                state.spaces.slide = None;
                if !back {
                    state.switch_space_now(toward);
                }
                TimeoutAction::Drop
            });
    }

    /// Show Space `target` now: its windows come on screen, the others leave.
    pub(crate) fn switch_space_now(&mut self, target: usize) {
        let previous = self.spaces.current;
        if target == previous {
            return;
        }
        self.carry_held(target);
        // Off the screen back to front, so each waits with its place in the stack.
        let leaving: Vec<WindowId> = self
            .space
            .elements()
            .filter_map(|window| self.windows.by_window(window).map(|entry| entry.id))
            .collect();
        for id in &leaving {
            self.space_unmap(*id);
        }
        self.spaces.current = target;
        // Back on it back to front, each mapped over the ones before.
        let arriving: Vec<WindowId> = self
            .windows
            .waiting_on(target)
            .iter()
            .map(|entry| entry.id)
            .collect();
        for id in &arriving {
            self.space_map(*id);
        }
        // A window carried across stays in front, with the keyboard; the
        // Space's own windows were mapped over it.
        let carried = self
            .held
            .or(self.carried.take())
            .filter(|id| self.on_current_space(*id) && self.focus_window(*id).is_ok());
        if carried.is_none() {
            self.focus_topmost();
        }
        self.emit_space(previous);
    }

    /// `space-move {window, space}`.
    pub(crate) fn move_to_space(&mut self, id: WindowId, space: usize) -> Result<(), String> {
        if space >= self.spaces.count {
            return Err(format!("no Space {space}"));
        }
        let entry = self
            .windows
            .get(id)
            .filter(|e| e.announced)
            .ok_or_else(|| format!("no window {id}"))?;
        if entry.space == space {
            return Ok(());
        }
        let was_focused = self.is_focused(&entry.window);
        self.space_unmap(id);
        if let Some(entry) = self.windows.get_mut(id) {
            entry.space = space;
        }
        // Put on a Space, it is in front there.
        self.windows.rank_front(id);
        self.space_map(id);
        if was_focused && space != self.spaces.current {
            self.focus_topmost();
        }
        self.ipc
            .emit("window-space", json!({ "window": id, "space": space }));
        Ok(())
    }

    /// A window activated on another Space: switch there, or bring it here (`follow`).
    pub(crate) fn reach_space_of(&mut self, id: WindowId) {
        let Some(space) = self.windows.get(id).map(|e| e.space) else {
            return;
        };
        if space == self.spaces.current {
            return;
        }
        if self.spaces.follow {
            self.spaces.slide = None;
            self.switch_space_now(space);
        } else {
            let _ = self.move_to_space(id, self.spaces.current);
        }
    }

    /// A window held in a move grab goes to `target` with the switch, and
    /// stays on screen under the pointer (wm/grabs/move_grab.rs).
    fn carry_held(&mut self, target: usize) {
        for id in [self.held, self.carried].into_iter().flatten() {
            let Some(entry) = self.windows.get_mut(id) else {
                continue;
            };
            if entry.space == target || entry.shown != Shown::Normal {
                continue;
            }
            entry.space = target;
            self.ipc
                .emit("window-space", json!({ "window": id, "space": target }));
        }
    }

    /// Off screen, remembering where (a window on a Space that is not shown).
    fn space_unmap(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id) else {
            return;
        };
        if entry.space != self.spaces.current || entry.shown != Shown::Normal || !entry.placed {
            return;
        }
        let window = entry.window.clone();
        let at = self.space.element_location(&window);
        if let Some(entry) = self.windows.get_mut(id) {
            entry.away_at = at;
        }
        self.windows.rank_front(id);
        self.space.unmap_elem(&window);
    }

    /// On screen where it was, if it belongs on the current Space.
    fn space_map(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id) else {
            return;
        };
        if entry.space != self.spaces.current || entry.shown != Shown::Normal || !entry.placed {
            return;
        }
        // Carried across: it never left the screen.
        if self.goes_along(id) && self.space.element_location(&entry.window).is_some() {
            return;
        }
        let (window, at) = (entry.window.clone(), entry.away_at);
        if let Some(at) = at {
            super::actions::x11_follow(&window, at);
            self.space.map_element(window, at, false);
        }
    }

    pub(super) fn emit_space(&mut self, previous: usize) {
        let event = json!({ "current": self.spaces.current, "previous": previous, "count": self.spaces.count });
        self.ipc.emit("space", event);
    }

    /// Where a window on Space `space` is drawn during a slide, by the slide's offset (logical, x).
    pub(crate) fn slide_offset(&self, space: usize, width: i32) -> Option<Point<i32, Logical>> {
        let slide = self.spaces.slide?;
        let dir = if slide.to > slide.from { 1.0 } else { -1.0 };
        let w = f64::from(width);
        let dx = if space == slide.from {
            -dir * slide.at * w
        } else if space == slide.to {
            dir * (1.0 - slide.at) * w
        } else {
            return None;
        };
        Some(Point::from((dx.round() as i32, 0)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slides_ease_out_and_stay_in_range() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert_eq!(ease(2.0), 1.0);
        assert!(ease(0.5) > 0.5, "fast first, then slow");
    }
}
