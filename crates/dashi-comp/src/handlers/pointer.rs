//! The pointer's protocols: relative motion and pointer constraints (games,
//! remote desktops), touchpad gestures for clients (pinch to zoom), and
//! cursor-shape (a named cursor instead of a cursor surface). Locking and
//! confining are carried out in input/constraints.rs.

use smithay::{
    delegate_cursor_shape, delegate_pointer_constraints, delegate_pointer_gestures,
    delegate_relative_pointer,
    input::pointer::PointerHandle,
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    utils::{Logical, Point},
    wayland::{
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
    // A constraint takes hold at once if the pointer is over its surface; else
    // when the pointer enters it (input/constraints.rs).
    fn new_constraint(&mut self, surface: &WlSurface, pointer: &PointerHandle<Self>) {
        if pointer.current_focus().as_ref() == Some(surface) {
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
        let origin = self
            .space
            .elements()
            .find(|window| window.wl_surface().as_deref() == Some(surface))
            .and_then(|window| self.space.element_location(window));
        if let Some(origin) = origin {
            pointer.set_location(origin.to_f64() + location);
        }
    }
}

// cursor-shape asks for it; Dashi has no tablets yet.
impl TabletSeatHandler for Dashi {}

delegate_relative_pointer!(Dashi);
delegate_pointer_constraints!(Dashi);
delegate_pointer_gestures!(Dashi);
delegate_cursor_shape!(Dashi);
