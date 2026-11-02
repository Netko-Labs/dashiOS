//! Inhibitors: idle-inhibit (a video playing keeps the screen on while its
//! surface is on screen) and keyboard-shortcuts-inhibit (a remote desktop or a
//! virtual machine gets the keys the shell's keymap would take, while it has
//! the keyboard; ❖ and the built-ins, such as switching VTs, stay Dashi's).

use smithay::{
    delegate_idle_inhibit, delegate_keyboard_shortcuts_inhibit,
    desktop::layer_map_for_output,
    reexports::wayland_server::{DisplayHandle, Resource, protocol::wl_surface::WlSurface},
    wayland::{
        compositor::get_parent,
        idle_inhibit::{IdleInhibitHandler, IdleInhibitManagerState},
        keyboard_shortcuts_inhibit::{
            KeyboardShortcutsInhibitHandler, KeyboardShortcutsInhibitState,
            KeyboardShortcutsInhibitor, KeyboardShortcutsInhibitorSeat,
        },
        seat::WaylandFocus,
    },
};

use crate::state::Dashi;

pub(crate) fn create_globals(dh: &DisplayHandle) -> KeyboardShortcutsInhibitState {
    IdleInhibitManagerState::new::<Dashi>(dh);
    KeyboardShortcutsInhibitState::new::<Dashi>(dh)
}

impl IdleInhibitHandler for Dashi {
    fn inhibit(&mut self, surface: WlSurface) {
        self.idle.inhibitors.push(surface);
    }

    fn uninhibit(&mut self, surface: WlSurface) {
        self.idle.inhibitors.retain(|s| s != &surface);
    }
}

impl KeyboardShortcutsInhibitHandler for Dashi {
    fn keyboard_shortcuts_inhibit_state(&mut self) -> &mut KeyboardShortcutsInhibitState {
        &mut self.shortcuts_inhibit_state
    }

    fn new_inhibitor(&mut self, inhibitor: KeyboardShortcutsInhibitor) {
        inhibitor.activate();
    }
}

impl Dashi {
    /// Whether a surface asking to keep the screen on is on screen now.
    pub(crate) fn idle_inhibited(&mut self) -> bool {
        self.idle.inhibitors.retain(Resource::is_alive);
        self.idle.inhibitors.iter().any(|surface| {
            let mut root = surface.clone();
            while let Some(parent) = get_parent(&root) {
                root = parent;
            }
            let window_shown = self
                .space
                .elements()
                .any(|window| window.wl_surface().as_deref() == Some(&root));
            window_shown
                || self.space.outputs().any(|output| {
                    layer_map_for_output(output)
                        .layer_for_surface(&root, smithay::desktop::WindowSurfaceType::ALL)
                        .is_some()
                })
        })
    }

    /// Whether the client with the keyboard has its shortcuts inhibitor active.
    pub(crate) fn shortcuts_inhibited(&self) -> bool {
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .and_then(|focus| self.seat.keyboard_shortcuts_inhibitor_for_surface(&focus))
            .is_some_and(|inhibitor| inhibitor.is_active())
    }
}

delegate_idle_inhibit!(Dashi);
delegate_keyboard_shortcuts_inhibit!(Dashi);
