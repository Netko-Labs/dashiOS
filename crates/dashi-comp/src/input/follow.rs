//! A still pointer and the windows moving under it. Pointer focus moves on
//! motion; when a window is tiled, placed, or closed away from a pointer that
//! didn't move, the surface it was over would never hear it leave (a
//! toolbar button's hover and tooltip stay up). After each dispatch the
//! pointer enters whatever is under it now, so the one it left hears it go.

use smithay::{
    input::pointer::PointerHandle, wayland::pointer_constraints::with_pointer_constraint,
};

use crate::state::Dashi;

impl Dashi {
    /// Each seat's pointer enters what is under it now, if that changed.
    pub(crate) fn follow_pointers(&mut self) {
        let time = self.start_time.elapsed().as_millis() as u32;
        // Not while it stands aside for an agent in the same app's off-screen window (session/agent_away.rs).
        if let Some(pointer) = self.seat.get_pointer()
            && !self.agent.away.pointer_aside()
        {
            self.follow_pointer(&pointer, time);
        }
        // An agent's own seat (session/agent.rs) only while its pointer is in a surface:
        // one that never moved isn't anywhere, and shouldn't enter what is at 0, 0.
        if let Some(pointer) = self.agent.seat.as_ref().and_then(|seat| seat.get_pointer())
            && pointer.current_focus().is_some()
        {
            self.follow_pointer(&pointer, time);
        }
    }

    fn follow_pointer(&mut self, pointer: &PointerHandle<Self>, time: u32) {
        // A locked or confined pointer keeps its surface wherever that goes (constraints.rs).
        let held = pointer.current_focus().is_some_and(|surface| {
            with_pointer_constraint(&surface, pointer, |constraint| {
                constraint.is_some_and(|constraint| constraint.is_active())
            })
        });
        if !held {
            self.refresh_pointer_focus(pointer, pointer.current_location(), time);
        }
    }
}
