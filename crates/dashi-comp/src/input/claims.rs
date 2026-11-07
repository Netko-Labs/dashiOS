//! What the shell claims of the pointer and touchpad: a band along a
//! screen's bottom edge (`edges`, the Dock's autohide), and swipes with some
//! numbers of fingers (`gestures`, Spaces). Claimed swipes go to the shell,
//! not to clients; the band only reports, it takes nothing.

use serde_json::json;
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
            self.ipc
                .emit("edge", json!({ "edge": "bottom", "inside": inside }));
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
