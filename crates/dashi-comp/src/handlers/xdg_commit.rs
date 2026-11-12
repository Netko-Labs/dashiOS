//! xdg-shell's side of a commit: a new toplevel's or popup's first configure,
//! and a popup kept inside the screen.

use smithay::{
    desktop::{PopupKind, PopupManager, find_popup_root_surface, get_popup_toplevel_coords},
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    wayland::{
        compositor::with_states,
        shell::xdg::{PopupSurface, XdgToplevelSurfaceData},
    },
};

use crate::{state::Dashi, wm::Windows};

/// Should be called on `WlSurface::commit`
/// Should be called on `WlSurface::commit`. New windows are not in the space
/// until the shell places them, so toplevels are found in the registry.
pub(crate) fn handle_commit(popups: &mut PopupManager, windows: &Windows, surface: &WlSurface) {
    // Handle toplevel commits: the first configure, which lets the client draw.
    if let Some(entry) = windows.by_surface(surface) {
        let initial_configure_sent = with_states(surface, |states| {
            states
                .data_map
                .get::<XdgToplevelSurfaceData>()
                .and_then(|data| data.lock().ok())
                .is_some_and(|data| data.initial_configure_sent)
        });

        if let Some(toplevel) = entry.window.toplevel().filter(|_| !initial_configure_sent) {
            toplevel.send_configure();
        }
    }

    // Handle popup commits.
    popups.commit(surface);
    if let Some(popup) = popups.find_popup(surface) {
        match popup {
            PopupKind::Xdg(ref xdg) => {
                if !xdg.is_initial_configure_sent() {
                    // NOTE: This should never fail as the initial configure is always
                    // allowed.
                    if let Err(error) = xdg.send_configure() {
                        tracing::warn!(?error, "initial popup configure");
                    }
                }
            }
            PopupKind::InputMethod(ref _input_method) => {}
        }
    }
}

impl Dashi {
    /// Keep `popup` inside the screen its window is on.
    pub(super) fn unconstrain_popup(&self, popup: &PopupSurface) {
        let Ok(root) = find_popup_root_surface(&PopupKind::Xdg(popup.clone())) else {
            return;
        };
        let Some(window) = self
            .space
            .elements()
            .find(|w| w.toplevel().is_some_and(|t| t.wl_surface() == &root))
        else {
            return;
        };

        let Some(output_geo) = self
            .space
            .outputs()
            .next()
            .and_then(|output| self.space.output_geometry(output))
        else {
            return;
        };
        let Some(window_geo) = self.space.element_geometry(window) else {
            return;
        };

        // The target geometry for the positioner should be relative to its parent's geometry, so
        // we will compute that here.
        let mut target = output_geo;
        target.loc -= get_popup_toplevel_coords(&PopupKind::Xdg(popup.clone()));
        target.loc -= window_geo.loc;

        popup.with_pending_state(|state| {
            state.geometry = state.positioner.get_unconstrained_geometry(target);
        });
    }
}
