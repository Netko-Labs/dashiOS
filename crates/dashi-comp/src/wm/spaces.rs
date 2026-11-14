//! Spaces: every window belongs to one; only the current Space's windows are
//! on screen. The shell decides how many there are, when to switch, and where
//! windows go (packages/shell/src/spaces/); the compositor keeps each window's
//! Space and slides between them, following a swipe (`space-switch {progress}`).

mod membership;
mod slide;

use super::windows::{Shown, WindowId};
use crate::ipc::protocol::{Event, SpacesAnswer};
use crate::state::Dashi;

pub(crate) const MAX_SPACES: usize = 16;

pub(crate) struct Spaces {
    pub count: usize,
    pub current: usize,
    /// Activating a window on another Space switches there (else the window comes here).
    pub follow: bool,
    /// A switch in progress: the windows of `from` and `to` drawn `at` (0–1) of the way.
    pub slide: Option<Slide>,
    /// Spaces where a window's own activation switches nothing (`spaces {quiet}`: an agent at
    /// work there, and the person's screen is not to move for it). The shell says which.
    pub quiet: Vec<usize>,
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
            quiet: Vec::new(),
        }
    }
}

impl Spaces {
    pub(crate) fn answer(&self) -> SpacesAnswer {
        SpacesAnswer::new(self.count, self.current)
    }
}

impl Dashi {
    /// Whether a window is on screen now: shown, and on the current Space.
    /// Window `id` goes along when the Space changes: held in a move grab, or carried (`space-switch {carry}`).
    pub(crate) fn goes_along(&self, id: WindowId) -> bool {
        self.held == Some(id) || self.carried == Some(id)
    }

    /// Whether window `id` asking to be activated may bring its Space on screen: not from a
    /// quiet Space that does not show.
    pub(crate) fn activation_may_switch(&self, id: WindowId) -> bool {
        self.windows.get(id).is_none_or(|entry| {
            entry.space == self.spaces.current || !self.spaces.quiet.contains(&entry.space)
        })
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
    ) -> Result<SpacesAnswer, String> {
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
    ) -> Result<SpacesAnswer, String> {
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

    /// Show Space `target` now: its windows come on screen, the others leave.
    pub(crate) fn switch_space_now(&mut self, target: usize) {
        let previous = self.spaces.current;
        if target == previous {
            return;
        }
        // An agent's pointer in a window off screen leaves it: the windows change places.
        self.away_pointer_leave();
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

    pub(super) fn emit_space(&mut self, previous: usize) {
        let (current, count) = (self.spaces.current, self.spaces.count);
        self.ipc.emit(Event::space(current, previous, count));
    }
}
