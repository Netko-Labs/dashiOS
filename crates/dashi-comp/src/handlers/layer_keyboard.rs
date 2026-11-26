//! Which layer surface that takes the keyboard exclusively has it: the one
//! shown last. Each such surface is stamped when it shows (its first commit
//! with a buffer after none), and a commit gives it the keyboard only when the
//! surface that has it was not shown after it. Two exclusive surfaces up at
//! once (the launcher over Control Center) used to take the keyboard from
//! each other on every frame either drew, so the keys typed went half to one
//! and half to the other.

use std::{
    cell::Cell,
    sync::atomic::{AtomicU64, Ordering},
};

use smithay::{
    backend::renderer::utils::with_renderer_surface_state,
    desktop::layer_map_for_output,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    wayland::{compositor::with_states, shell::wlr_layer::KeyboardInteractivity},
};

use crate::state::Dashi;

/// When a surface was shown, in the order surfaces were; 0: it doesn't show.
#[derive(Default)]
struct Shown(Cell<u64>);

/// The stamp the next surface shown gets.
static NEXT: AtomicU64 = AtomicU64::new(1);

/// `surface`'s stamp after a commit in which it `shows` (takes the keyboard exclusively, with a
/// buffer): kept while it shows, a new one when it starts to, 0 when it stops.
pub(super) fn stamp(surface: &WlSurface, shows: bool) -> u64 {
    with_states(surface, |states| {
        states.data_map.insert_if_missing(Shown::default);
        let Some(shown) = states.data_map.get::<Shown>() else {
            return 0;
        };
        let next = match (shows, shown.0.get()) {
            (false, _) => 0,
            (true, 0) => NEXT.fetch_add(1, Ordering::Relaxed),
            (true, kept) => kept,
        };
        shown.0.set(next);
        next
    })
}

/// `surface`'s stamp as its last commit left it; 0 for one that never took the keyboard so.
fn stamp_of(surface: &WlSurface) -> u64 {
    with_states(surface, |states| {
        states
            .data_map
            .get::<Shown>()
            .map_or(0, |shown| shown.0.get())
    })
}

/// Whether `surface` takes the keyboard exclusively and has a buffer now.
pub(super) fn shows(surface: &WlSurface, exclusive: KeyboardInteractivity) -> bool {
    exclusive == KeyboardInteractivity::Exclusive
        && with_renderer_surface_state(surface, |state| state.buffer().is_some()).unwrap_or(false)
}

/// Whether a surface shown at `stamp` takes the keyboard from its holder, shown at `holder`
/// (0: the holder is no exclusive surface that shows, a window say).
pub(super) fn takes_keyboard(stamp: u64, holder: u64) -> bool {
    stamp > 0 && holder <= stamp
}

impl Dashi {
    /// The stamp of whatever has the keyboard (0 when it is no exclusive surface that shows).
    pub(super) fn keyboard_holder_stamp(&self) -> u64 {
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .map_or(0, |focus| stamp_of(&focus))
    }

    /// The exclusive layer surface shown last, on any screen, but `except`.
    pub(super) fn newest_exclusive(&self, except: &WlSurface) -> Option<WlSurface> {
        self.space
            .outputs()
            .flat_map(|output| {
                let map = layer_map_for_output(output);
                map.layers()
                    .map(|layer| layer.wl_surface().clone())
                    .filter(|surface| surface != except)
                    .map(|surface| (stamp_of(&surface), surface))
                    .collect::<Vec<_>>()
            })
            .filter(|(stamp, _)| *stamp > 0)
            .max_by_key(|(stamp, _)| *stamp)
            .map(|(_, surface)| surface)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_surface_shown_last_keeps_the_keyboard() {
        // Control Center (shown first, 3) and the launcher over it (shown after, 7).
        let (control_center, launcher) = (3, 7);
        // Control Center draws a frame while the launcher has the keyboard: it takes nothing.
        assert!(!takes_keyboard(control_center, launcher));
        // The launcher draws while Control Center has it (it was shown over it): it takes it.
        assert!(takes_keyboard(launcher, control_center));
        // From a window (no stamp), or from a sheet that hid, anything shown takes it.
        assert!(takes_keyboard(control_center, 0));
        // A surface that doesn't show (no buffer) never does.
        assert!(!takes_keyboard(0, 0));
    }
}
