//! The pointer's protocols: relative motion and pointer constraints (games,
//! remote desktops), touchpad gestures for clients (pinch to zoom), and
//! cursor-shape (a named cursor instead of a cursor surface). Locking and
//! confining are carried out in input/constraints.rs.

use smithay::{
    delegate_cursor_shape, delegate_pointer_constraints, delegate_pointer_gestures,
    delegate_relative_pointer,
    input::pointer::PointerHandle,
    reexports::wayland_server::{DisplayHandle, Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Point, Rectangle},
    wayland::{
        compositor::CompositorHandler,
        cursor_shape::CursorShapeManagerState,
        pointer_constraints::{
            PointerConstraintsHandler, PointerConstraintsState, with_pointer_constraint,
        },
        pointer_gestures::PointerGesturesState,
        relative_pointer::RelativePointerManagerState,
        seat::WaylandFocus,
        tablet_manager::TabletSeatHandler,
    },
};

use crate::state::Dashi;

pub(crate) fn create_globals(dh: &DisplayHandle) {
    RelativePointerManagerState::new::<Dashi>(dh);
    PointerConstraintsState::new::<Dashi>(dh);
    PointerGesturesState::new::<Dashi>(dh);
    CursorShapeManagerState::new::<Dashi>(dh);
}

impl PointerConstraintsHandler for Dashi {
    // A constraint takes hold at once if the pointer is over its surface and the
    // keyboard in its window; else when both are (input/constraints.rs).
    fn new_constraint(&mut self, surface: &WlSurface, pointer: &PointerHandle<Self>) {
        if pointer.current_focus().as_ref() == Some(surface) && self.may_hold(surface) {
            with_pointer_constraint(surface, pointer, |constraint| {
                if let Some(constraint) = constraint {
                    constraint.activate();
                }
            });
        }
    }

    // Where a locked pointer should be when it is let go.
    fn cursor_position_hint(
        &mut self,
        surface: &WlSurface,
        pointer: &PointerHandle<Self>,
        location: Point<f64, Logical>,
    ) {
        let active = with_pointer_constraint(surface, pointer, |constraint| {
            constraint.is_some_and(|c| c.is_active())
        });
        if !active {
            return;
        }
        let Some(window) = self
            .space
            .elements()
            .find(|window| window.wl_surface().as_deref() == Some(surface))
        else {
            return;
        };
        let Some(origin) = self.space.element_location(window) else {
            return;
        };
        // Xwayland speaks in its own pixels (xwayland/scale.rs); smithay passes the hint as sent.
        let scale = surface
            .client()
            .map(|client| self.client_compositor_state(&client).client_scale())
            .filter(|scale| *scale > 0.0)
            .unwrap_or(1.0);
        // The surface's origin is its window's, less what it draws around itself (shadows).
        let geometry = window.geometry().to_f64();
        if let Some(hint) = hint_in(location, scale, geometry) {
            pointer.set_location(origin.to_f64() - geometry.loc + hint);
        }
    }
}

/// Where a locked pointer's hint (`location`, in the pixels of a client at
/// `scale`) is on its surface, whose window is `window` of it. None outside the
/// window: there the pointer would be over something else, and the lock would
/// go with it.
fn hint_in(
    location: Point<f64, Logical>,
    scale: f64,
    window: Rectangle<f64, Logical>,
) -> Option<Point<f64, Logical>> {
    let hint = location.downscale(scale);
    window.contains(hint).then_some(hint)
}

// cursor-shape asks for it; Dashi has no tablets yet.
impl TabletSeatHandler for Dashi {}

delegate_relative_pointer!(Dashi);
delegate_pointer_constraints!(Dashi);
delegate_pointer_gestures!(Dashi);
delegate_cursor_shape!(Dashi);

#[cfg(test)]
mod tests {
    use smithay::utils::{Logical, Rectangle};

    use super::hint_in;

    #[test]
    fn an_x11_games_hint_is_in_xwaylands_pixels() {
        // GLFW on X11 keeps the pointer at the window's middle: 1440, 900 of 2880 by 1800
        // X11 pixels is 720, 450 of a window 1440 by 900 at scale 2 (not its far corner).
        let size = Rectangle::<f64, Logical>::from_size((1440.0, 900.0).into());
        assert_eq!(
            hint_in((1440.0, 900.0).into(), 2.0, size),
            Some((720.0, 450.0).into())
        );
        // A Wayland client's is as sent.
        assert_eq!(
            hint_in((100.0, 50.0).into(), 1.0, size),
            Some((100.0, 50.0).into())
        );
    }

    #[test]
    fn a_hint_outside_the_window_is_not_followed() {
        let size = Rectangle::<f64, Logical>::from_size((800.0, 600.0).into());
        assert_eq!(hint_in((800.0, 600.0).into(), 1.0, size), None);
        assert_eq!(hint_in((-1.0, 10.0).into(), 1.0, size), None);
    }
}
