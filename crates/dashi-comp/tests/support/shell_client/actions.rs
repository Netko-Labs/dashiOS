//! What a test asks a connection to do: open a window, lock, show a sheet,
//! type.

use std::{io::Write, os::fd::AsFd};

use wayland_client::protocol::wl_output;
use wayland_protocols::ext::session_lock::v1::client::ext_session_lock_manager_v1;
use wayland_protocols::xdg::activation::v1::client::xdg_activation_v1;
use wayland_protocols::xdg::shell::client::xdg_wm_base;
use wayland_protocols_misc::zwp_input_method_v2::client::zwp_input_method_manager_v2;
use wayland_protocols_misc::zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_manager_v1;
use wayland_protocols_wlr::layer_shell::v1::client::zwlr_layer_shell_v1;
use wayland_protocols_wlr::layer_shell::v1::client::zwlr_layer_surface_v1;

use super::Conn;

impl Conn {
    /// A window (an xdg toplevel), shown once the compositor has configured and placed it.
    pub fn window(&mut self, app_id: &str, title: &str) {
        let wm_base: xdg_wm_base::XdgWmBase =
            self.globals.bind(&self.qh, 1..=6, ()).expect("xdg_wm_base");
        let surface = self.compositor.create_surface(&self.qh, ());
        let xdg = wm_base.get_xdg_surface(&surface, &self.qh, ());
        let toplevel = xdg.get_toplevel(&self.qh, ());
        toplevel.set_app_id(app_id.into());
        toplevel.set_title(title.into());
        surface.commit();
        self.state.surface = Some(surface);
        self.state.xdg = Some((xdg, toplevel));
        self.roundtrip();
        self.roundtrip();
    }

    /// The window goes away (its client destroys it).
    pub fn close_window(&mut self) {
        if let Some((xdg, toplevel)) = self.state.xdg.take() {
            toplevel.destroy();
            xdg.destroy();
        }
        if let Some(surface) = self.state.surface.take() {
            surface.destroy();
        }
        self.roundtrip();
    }

    /// Lock the session; `locked` once the compositor confirms.
    pub fn lock(&mut self) {
        let manager: ext_session_lock_manager_v1::ExtSessionLockManagerV1 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("ext_session_lock_manager_v1 (the shell's)");
        self.state.lock = Some(manager.lock(&self.qh, ()));
        self.roundtrip();
        assert!(self.state.locked, "the compositor did not lock");
    }

    /// The lock screen's surface on the first screen, drawn at the size asked.
    pub fn lock_surface(&mut self) {
        let output: wl_output::WlOutput =
            self.globals.bind(&self.qh, 1..=4, ()).expect("wl_output");
        let surface = self.compositor.create_surface(&self.qh, ());
        let lock = self.state.lock.as_ref().expect("locked first");
        let lock_surface = lock.get_lock_surface(&surface, &output, &self.qh, ());
        self.state.surface = Some(surface);
        self.state.lock_surface = Some(lock_surface);
        self.roundtrip();
        self.roundtrip();
        assert!(self.state.lock_shown, "the lock surface was not configured");
    }

    pub fn unlock(&mut self) {
        if let Some(lock) = self.state.lock.take() {
            lock.unlock_and_destroy();
        }
        self.roundtrip();
    }

    /// A shell sheet on the overlay layer that takes the keyboard (`exclusive`) or not.
    pub fn sheet(&mut self, exclusive: bool) {
        let shell: zwlr_layer_shell_v1::ZwlrLayerShellV1 = self
            .globals
            .bind(&self.qh, 1..=4, ())
            .expect("zwlr_layer_shell_v1");
        let surface = self.compositor.create_surface(&self.qh, ());
        let layer = shell.get_layer_surface(
            &surface,
            None,
            zwlr_layer_shell_v1::Layer::Overlay,
            "dashi.test-sheet".into(),
            &self.qh,
            (),
        );
        layer.set_size(400, 200);
        let keyboard = if exclusive {
            zwlr_layer_surface_v1::KeyboardInteractivity::Exclusive
        } else {
            zwlr_layer_surface_v1::KeyboardInteractivity::None
        };
        layer.set_keyboard_interactivity(keyboard);
        surface.commit();
        self.state.surface = Some(surface);
        self.state.layer = Some(layer);
        self.roundtrip();
        self.roundtrip();
        // A commit after the first configure is when one that is exclusive asks for the keyboard.
        if let Some(surface) = &self.state.surface {
            surface.commit();
        }
        self.roundtrip();
    }

    /// The sheet goes away (its client destroys it, as a Metal host hiding it does).
    pub fn close_sheet(&mut self) {
        if let Some(layer) = self.state.layer.take() {
            layer.destroy();
        }
        if let Some(surface) = self.state.surface.take() {
            surface.destroy();
        }
        self.roundtrip();
    }

    /// The window asks for the keyboard with a token of its own that names no surface
    /// (xdg-activation), as an app that brings itself forward does.
    pub fn activate_self(&mut self) {
        let activation: xdg_activation_v1::XdgActivationV1 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("xdg_activation_v1");
        let token = activation.get_activation_token(&self.qh, ());
        token.commit();
        self.roundtrip();
        let token = self.state.token.take().expect("an activation token");
        let surface = self.state.surface.as_ref().expect("a window first");
        activation.activate(token, surface);
        self.roundtrip();
    }

    /// Be the seat's input method and grab its keyboard, as fcitx5 does while a field is active.
    #[allow(dead_code)] // tests/agent_keys.rs; the lock tests don't.
    pub fn grab_keyboard_as_input_method(&mut self) {
        let manager: zwp_input_method_manager_v2::ZwpInputMethodManagerV2 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("zwp_input_method_manager_v2 (the shell's)");
        let method = manager.get_input_method(&self.seat, &self.qh, ());
        let grab = method.grab_keyboard(&self.qh, ());
        self.state.input_method = Some((method, grab));
        self.roundtrip();
    }

    /// Press and release `key` (evdev) on a virtual keyboard: it goes to whatever has the keyboard.
    pub fn type_key(&mut self, key: u32) {
        if self.state.keyboard_typist.is_none() {
            let manager: zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1 = self
                .globals
                .bind(&self.qh, 1..=1, ())
                .expect("zwp_virtual_keyboard_manager_v1 (the shell's)");
            let keyboard = manager.create_virtual_keyboard(&self.seat, &self.qh, ());
            let mut file = tempfile::tempfile().expect("a keymap file");
            let keymap = concat!(
                "xkb_keymap { xkb_keycodes { include \"evdev+aliases(qwerty)\" }; ",
                "xkb_types { include \"complete\" }; xkb_compat { include \"complete\" }; ",
                "xkb_symbols { include \"pc+us+inet(evdev)\" }; };\0"
            );
            file.write_all(keymap.as_bytes()).expect("the keymap");
            keyboard.keymap(1, file.as_fd(), keymap.len() as u32);
            self.state.keyboard_typist = Some(keyboard);
        }
        let keyboard = self.state.keyboard_typist.as_ref().expect("made above");
        keyboard.key(0, key, 1);
        keyboard.key(1, key, 0);
        self.roundtrip();
    }
}
