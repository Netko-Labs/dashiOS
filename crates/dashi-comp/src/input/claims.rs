//! What the shell claims of the pointer and touchpad: a band along a
//! screen's bottom edge (`edges`, the Dock's autohide), and swipes with some
//! numbers of fingers (`gestures`, Spaces). Claimed swipes go to the shell,
//! not to clients; the band only reports, it takes nothing. A locked pointer
//! (a game's) is in no band and over no light.

use crate::ipc::protocol::{Bottom, Event};
use smithay::utils::{Logical, Point};

use crate::state::Dashi;

#[derive(Default)]
pub(crate) struct Claims {
    /// The bottom band's height (0: none) and the screen it is on (none: every screen).
    bottom: i32,
    output: Option<String>,
    inside: bool,
    swipe_fingers: Vec<u32>,
    /// A claimed swipe is going on.
    pub swiping: bool,
    /// The pointer was locked when last looked at (`pointer_lock_changed`).
    locked: bool,
}

impl Dashi {
    /// `edges {bottom, output?}`: answers whether the pointer is in the band now.
    pub(crate) fn claim_bottom(&mut self, band: i32, output: Option<String>) -> bool {
        self.claims.bottom = band.clamp(0, 200);
        self.claims.output = output;
        let at = self.seat.get_pointer().map(|p| p.current_location());
        self.claims.inside = at.is_some_and(|at| self.in_bottom_band(at));
        self.claims.inside
    }

    fn in_bottom_band(&self, at: Point<f64, Logical>) -> bool {
        if self.claims.bottom == 0 {
            return false;
        }
        let Some(output) = self.space.output_under(at).next() else {
            return false;
        };
        if self
            .claims
            .output
            .as_ref()
            .is_some_and(|name| name != &output.name())
        {
            return false;
        }
        self.space.output_geometry(output).is_some_and(|screen| {
            f64::from(screen.loc.y + screen.size.h) - at.y <= f64::from(self.claims.bottom)
        })
    }

    /// After the pointer moves: tell the shell when it enters or leaves the bottom band.
    pub(crate) fn watch_edges(&mut self, at: Point<f64, Logical>) {
        let inside = self.in_bottom_band(at);
        if inside != self.claims.inside {
            self.claims.inside = inside;
            self.ipc.emit(Event::Edge {
                edge: Bottom::Bottom,
                inside,
            });
        }
    }

    /// After each dispatch: a window took a lock on the pointer, or let it go.
    /// A locked pointer is nowhere for Dashi: what its place had lit or brought
    /// out goes at once (a light under it, the bars at the top edge, the Dock's
    /// band), since no motion will come to say it left. Let go, it is where it
    /// is again, and the same are told.
    pub(crate) fn pointer_lock_changed(&mut self) {
        let locked = self.pointer_locked();
        if locked == self.claims.locked {
            return;
        }
        self.claims.locked = locked;
        if locked {
            for entry in self.windows.entries_mut() {
                entry.hover = None;
            }
            self.leave_bars();
            if self.claims.inside {
                self.claims.inside = false;
                self.ipc.emit(Event::Edge {
                    edge: Bottom::Bottom,
                    inside: false,
                });
            }
        } else if let Some(at) = self.seat.get_pointer().map(|p| p.current_location()) {
            self.watch_bars(at);
            self.watch_edges(at);
            self.hover_controls(at);
        }
    }

    /// `gestures {swipe}`: the finger counts whose swipes are the shell's.
    pub(crate) fn claim_swipes(&mut self, fingers: Vec<u32>) {
        self.claims.swipe_fingers = fingers
            .into_iter()
            .filter(|f| (2..=5).contains(f))
            .collect();
    }

    /// While locked no swipe is the shell's: it goes to the lock screen.
    pub(crate) fn claims_swipe(&self, fingers: u32) -> bool {
        !self.lock.locked && self.claims.swipe_fingers.contains(&fingers)
    }
}
