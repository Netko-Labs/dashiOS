//! Pointer constraints carried out: a locked pointer stays where it is (the
//! client hears only relative motion), a confined one stays inside its
//! surface's region. A constraint takes hold when the pointer is over its
//! surface and inside its region, and the keyboard is in its window; it is the
//! pointer's own surface that holds it, whatever comes to lie under the pointer,
//! and it lets go when the keyboard leaves that window.

use smithay::{
    input::pointer::PointerHandle,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point},
    wayland::pointer_constraints::{PointerConstraint, with_pointer_constraint},
};

use crate::state::Dashi;

/// What holds the pointer where it is now.
pub(crate) enum Hold {
    Free,
    Locked,
    /// Kept on `surface` (whose origin is at `origin`), within `region` if any.
    Confined {
        surface: WlSurface,
        origin: Point<f64, Logical>,
        region: Option<smithay::wayland::compositor::RegionAttributes>,
    },
}

impl Dashi {
    /// What holds `pointer` now: the active constraint of the surface it is in.
    /// A lock holds whatever lies under the pointer (a banner that came up over
    /// the game, the strip of a title bar): only the keyboard leaving its window
    /// lets it go (`release_hold`). `under` is the surface under `at`.
    pub(crate) fn hold_at(
        &self,
        pointer: &PointerHandle<Self>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
        at: Point<f64, Logical>,
    ) -> Hold {
        let Some(focus) = pointer.current_focus() else {
            return Hold::Free;
        };
        with_pointer_constraint(&focus, pointer, |constraint| {
            let Some(constraint) = constraint.filter(|c| c.is_active()) else {
                return Hold::Free;
            };
            match &*constraint {
                PointerConstraint::Locked(_) => Hold::Locked,
                PointerConstraint::Confined(confined) => {
                    let Some((surface, origin)) = under.filter(|(surface, _)| *surface == focus)
                    else {
                        return Hold::Free;
                    };
                    let local = (at - *origin).to_i32_round();
                    if !confined
                        .region()
                        .is_none_or(|region| region.contains(local))
                    {
                        return Hold::Free;
                    }
                    Hold::Confined {
                        surface: surface.clone(),
                        origin: *origin,
                        region: confined.region().cloned(),
                    }
                }
            }
        })
    }

    /// Whether the person's pointer is locked (a game has it): nothing of Dashi's
    /// answers the pointer then, no edge band, no light, no title bar.
    pub(crate) fn pointer_locked(&self) -> bool {
        self.seat.get_pointer().is_some_and(|pointer| {
            matches!(
                self.hold_at(&pointer, None, pointer.current_location()),
                Hold::Locked
            )
        })
    }

    /// Whether a constraint on `surface` may take hold: the keyboard is in its
    /// window. A surface that is no window of Dashi's (an X11 window that
    /// manages itself) asks nothing of the keyboard.
    pub(crate) fn may_hold(&self, surface: &WlSurface) -> bool {
        let keyboard = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus());
        self.may_hold_with(surface, keyboard.as_ref())
    }

    /// `may_hold`, with the keyboard in `keyboard`.
    fn may_hold_with(&self, surface: &WlSurface, keyboard: Option<&WlSurface>) -> bool {
        let Some(window) = crate::wm::window_id_for_surface(self, surface) else {
            return true;
        };
        keyboard.and_then(|focus| crate::wm::window_id_for_surface(self, focus)) == Some(window)
    }

    /// The keyboard went to `focused`: a lock or confinement in another window
    /// is let go (the person went elsewhere: ❖Tab, the launcher, a sheet that
    /// needs them), and one in the window that got it takes hold again if the
    /// pointer is still there.
    pub(crate) fn hold_follows_keyboard(&mut self, focused: Option<&WlSurface>) {
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        let Some(surface) = pointer.current_focus() else {
            return;
        };
        // The keyboard is changing hands here: it is `focused`, not yet what the seat says.
        if self.may_hold_with(&surface, focused) {
            let at = pointer.current_location();
            let under = self.surface_under(at);
            self.activate_hold_with(&pointer, under.as_ref(), at, focused);
            return;
        }
        self.release_hold();
    }

    /// A lock the window with the keyboard asked for while the pointer was
    /// elsewhere (over the menu bar brought out, the Dock, another window): the
    /// pointer goes to the middle of that window and the lock takes hold. The
    /// person is in that app and it has taken the pointer (a game left its
    /// menu); left where it was, the pointer would run free under a game that
    /// thinks it locked, and what it was over would stay out.
    pub(crate) fn bring_pointer_to_lock(&mut self, pointer: &PointerHandle<Self>, time: u32) {
        if self.overview.is_some() || self.lock.locked || pointer.is_grabbed() {
            return;
        }
        let Some(surface) = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .filter(|surface| pointer.current_focus().as_ref() != Some(surface))
        else {
            return;
        };
        let asks = with_pointer_constraint(&surface, pointer, |constraint| {
            constraint
                .is_some_and(|c| !c.is_active() && matches!(&*c, PointerConstraint::Locked(_)))
        });
        let Some((at, geometry)) =
            self.windows
                .by_surface(&surface)
                .filter(|_| asks)
                .and_then(|entry| {
                    let at = self.space.element_location(&entry.window)?;
                    Some((at.to_f64(), entry.window.geometry().to_f64()))
                })
        else {
            return;
        };
        let middle = at + geometry.size.downscale(2.0).to_point();
        let event = smithay::input::pointer::MotionEvent {
            location: middle,
            serial: smithay::utils::SERIAL_COUNTER.next_serial(),
            time,
        };
        pointer.motion(self, Some((surface.clone(), at - geometry.loc)), &event);
        pointer.frame(self);
        with_pointer_constraint(&surface, pointer, |constraint| {
            if let Some(constraint) = constraint {
                constraint.activate();
            }
        });
    }

    /// Let go of the lock or confinement the pointer is under: the person asked
    /// for something of Dashi's that the pointer must reach (Mission Control).
    /// It takes hold again when the pointer next moves in its window.
    pub(crate) fn release_hold(&mut self) {
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        let Some(surface) = pointer.current_focus() else {
            return;
        };
        with_pointer_constraint(&surface, &pointer, |constraint| {
            if let Some(constraint) = constraint.filter(|c| c.is_active()) {
                constraint.deactivate();
            }
        });
    }

    /// Whether a confined pointer may go to `to` (over `under`).
    pub(crate) fn hold_allows(
        hold: &Hold,
        to: Point<f64, Logical>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
    ) -> bool {
        match hold {
            Hold::Free => true,
            Hold::Locked => false,
            Hold::Confined {
                surface,
                origin,
                region,
            } => {
                under.is_some_and(|(s, _)| s == surface)
                    && region
                        .as_ref()
                        .is_none_or(|region| region.contains((to - *origin).to_i32_round()))
            }
        }
    }

    /// The pointer is over `under`: its constraint, if any and not yet held, takes hold.
    pub(crate) fn activate_hold(
        &self,
        pointer: &PointerHandle<Self>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
        at: Point<f64, Logical>,
    ) {
        let keyboard = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus());
        self.activate_hold_with(pointer, under, at, keyboard.as_ref());
    }

    /// `activate_hold`, with the keyboard in `keyboard`.
    fn activate_hold_with(
        &self,
        pointer: &PointerHandle<Self>,
        under: Option<&(WlSurface, Point<f64, Logical>)>,
        at: Point<f64, Logical>,
        keyboard: Option<&WlSurface>,
    ) {
        let Some((surface, origin)) = under else {
            return;
        };
        if !self.may_hold_with(surface, keyboard) {
            return;
        }
        with_pointer_constraint(surface, pointer, |constraint| {
            if let Some(constraint) = constraint.filter(|c| !c.is_active()) {
                let local = (at - *origin).to_i32_round();
                if constraint
                    .region()
                    .is_none_or(|region| region.contains(local))
                {
                    constraint.activate();
                }
            }
        });
    }
}
