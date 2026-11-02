//! Typing beyond the keyboard: text-input (a text field tells where the caret
//! is) and input-method (an IME such as fcitx5 or IBus composes text for it),
//! and virtual-keyboard (an on-screen keyboard). An input method sees what is
//! typed and a virtual keyboard types anywhere, so only the shell's processes
//! (what the session starts) may bind them, and none in greeter mode.

use std::sync::{Arc, atomic::AtomicI32};

use smithay::{
    delegate_input_method_manager, delegate_text_input_manager, delegate_virtual_keyboard_manager,
    desktop::{PopupKind, PopupManager},
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    utils::{Logical, Rectangle},
    wayland::{
        input_method::{InputMethodHandler, InputMethodManagerState, PopupSurface},
        seat::WaylandFocus,
        text_input::TextInputManagerState,
        virtual_keyboard::VirtualKeyboardManagerState,
    },
};

use crate::{session::trust, state::Dashi};

pub(crate) fn create_globals(dh: &DisplayHandle, shell: &Arc<AtomicI32>, greeter: bool) {
    TextInputManagerState::new::<Dashi>(dh);
    let (ime_shell, keyboard_shell) = (shell.clone(), shell.clone());
    InputMethodManagerState::new::<Dashi, _>(dh, move |client| {
        !greeter && trust::is_shell_client(client, &ime_shell)
    });
    VirtualKeyboardManagerState::new::<Dashi, _>(dh, move |client| {
        !greeter && trust::is_shell_client(client, &keyboard_shell)
    });
}

impl InputMethodHandler for Dashi {
    fn new_popup(&mut self, surface: PopupSurface) {
        if let Err(error) = self.popups.track_popup(PopupKind::from(surface)) {
            tracing::debug!(?error, "an input method popup");
        }
    }

    fn popup_repositioned(&mut self, _surface: PopupSurface) {}

    fn dismiss_popup(&mut self, surface: PopupSurface) {
        if let Some(parent) = surface.get_parent().map(|parent| parent.surface.clone()) {
            let _ = PopupManager::dismiss_popup(&parent, &PopupKind::from(surface));
        }
    }

    fn parent_geometry(&self, parent: &WlSurface) -> Rectangle<i32, Logical> {
        self.space
            .elements()
            .find(|window| window.wl_surface().as_deref() == Some(parent))
            .map(|window| window.geometry())
            .unwrap_or_default()
    }
}

delegate_text_input_manager!(Dashi);
delegate_input_method_manager!(Dashi);
delegate_virtual_keyboard_manager!(Dashi);
