//! xdg-activation: who may take focus. A window may when its token is fresh
//! (under ten seconds) and came from the app that has the keyboard, or from
//! no surface at all (a launcher handing it over). Otherwise it is refused and
//! wants attention: the shell hears `window-attention` (the Dock can show it),
//! and the window says `attention` until it gets the keyboard.
//! Also xdg-dialog, so toolkits know a dialog can be modal, and xdg-foreign,
//! so a portal's dialog can be the child of the app window that asked for it.

use std::time::Duration;

use serde_json::json;
use smithay::{
    delegate_xdg_activation, delegate_xdg_dialog, delegate_xdg_foreign,
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    wayland::{
        shell::xdg::{ToplevelSurface, dialog::XdgDialogHandler},
        xdg_activation::{
            XdgActivationHandler, XdgActivationState, XdgActivationToken, XdgActivationTokenData,
        },
        xdg_foreign::{XdgForeignHandler, XdgForeignState},
    },
};

use crate::state::Dashi;

/// A token older than this activates nothing.
const FRESH: Duration = Duration::from_secs(10);

impl XdgActivationHandler for Dashi {
    fn activation_state(&mut self) -> &mut XdgActivationState {
        &mut self.activation_state
    }

    fn request_activation(
        &mut self,
        token: XdgActivationToken,
        data: XdgActivationTokenData,
        surface: WlSurface,
    ) {
        self.activation_state.remove_token(&token);
        let Some(id) = self
            .windows
            .by_surface(&surface)
            .filter(|e| e.announced)
            .map(|e| e.id)
        else {
            return;
        };
        let focused_client = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .and_then(|focus| focus.client().map(|client| client.id()));
        let from_focused = match &data.surface {
            None => true,
            Some(asker) => {
                asker.client().map(|client| client.id()) == focused_client
                    && focused_client.is_some()
            }
        };
        if data.timestamp.elapsed() < FRESH && from_focused {
            if let Err(error) = self.focus_window(id) {
                tracing::debug!(%error, "activating a window");
            }
            return;
        }
        if let Some(entry) = self.windows.get_mut(id)
            && !entry.attention
        {
            entry.attention = true;
            self.ipc.emit("window-attention", json!({ "window": id }));
        }
    }
}

delegate_xdg_activation!(Dashi);

impl XdgDialogHandler for Dashi {
    fn modal_changed(&mut self, _toplevel: ToplevelSurface, _is_modal: bool) {}
}

delegate_xdg_dialog!(Dashi);

impl XdgForeignHandler for Dashi {
    fn xdg_foreign_state(&mut self) -> &mut XdgForeignState {
        &mut self.xdg_foreign_state
    }
}

delegate_xdg_foreign!(Dashi);
