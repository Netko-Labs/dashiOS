//! wlr-layer-shell: the shell's own surfaces (menu bar, Dock, sheets, the
//! login and lock screens) on a screen's layers, above or below the windows.
//! Their exclusive zones are what the `usable` area leaves out; when that
//! changes, the shell hears `outputs-changed`.
//!
//! Who may open one is the shell's decision too: a client under an applet's
//! process only while the shell grants it (`applet-clients`,
//! session/applets.rs); other clients as in C1, any (C3: per-client grants).

use smithay::{
    delegate_layer_shell,
    desktop::{LayerSurface, WindowSurfaceType, layer_map_for_output},
    output::Output,
    reexports::wayland_server::{
        Resource,
        protocol::{wl_output, wl_surface::WlSurface},
    },
    utils::SERIAL_COUNTER,
    wayland::{
        compositor::with_states,
        shell::wlr_layer::{
            KeyboardInteractivity, Layer, LayerSurface as WlrLayerSurface, LayerSurfaceData,
            WlrLayerShellHandler, WlrLayerShellState,
        },
    },
};

use crate::state::{ClientState, Dashi};

/// The pid of the client that owns `surface`, when the compositor knows it.
fn client_pid(surface: &WlSurface) -> Option<i32> {
    surface
        .client()
        .and_then(|client| client.get_data::<ClientState>().and_then(|data| data.pid))
}

impl Dashi {
    /// Closes the layer surfaces of applet clients whose grant went (`applet-clients`).
    pub(crate) fn close_ungranted_layers(&mut self) {
        let outputs: Vec<Output> = self.space.outputs().cloned().collect();
        for output in &outputs {
            let map = layer_map_for_output(output);
            let ungranted: Vec<LayerSurface> = map
                .layers()
                .filter(|layer| {
                    !self
                        .applet_clients
                        .may_use_layer_shell(client_pid(layer.wl_surface()))
                })
                .cloned()
                .collect();
            drop(map);
            for layer in ungranted {
                layer.layer_surface().send_close();
            }
        }
    }
}

impl WlrLayerShellHandler for Dashi {
    fn shell_state(&mut self) -> &mut WlrLayerShellState {
        &mut self.layer_shell_state
    }

    fn new_layer_surface(
        &mut self,
        surface: WlrLayerSurface,
        wl_output: Option<wl_output::WlOutput>,
        _layer: Layer,
        namespace: String,
    ) {
        if !self
            .applet_clients
            .may_use_layer_shell(client_pid(surface.wl_surface()))
        {
            tracing::info!(
                namespace,
                "an applet's layer surface without a grant was closed"
            );
            surface.send_close();
            return;
        }
        let output = wl_output
            .as_ref()
            .and_then(Output::from_resource)
            .or_else(|| self.output_under_pointer());
        let Some(output) = output else {
            // No screen to put it on.
            surface.send_close();
            return;
        };
        self.layer_motion
            .made(surface.wl_surface().id(), &namespace);
        let mut map = layer_map_for_output(&output);
        if let Err(error) = map.map_layer(&LayerSurface::new(surface, namespace)) {
            tracing::warn!(?error, "a layer surface could not be mapped");
        }
    }

    fn layer_destroyed(&mut self, surface: WlrLayerSurface) {
        self.layer_motion.gone(&surface.wl_surface().id());
        let mut had_focus = false;
        let outputs: Vec<Output> = self.space.outputs().cloned().collect();
        for output in &outputs {
            let mut map = layer_map_for_output(output);
            let layer = map
                .layers()
                .find(|layer| layer.layer_surface() == &surface)
                .cloned();
            if let Some(layer) = layer {
                had_focus = self.has_keyboard(layer.wl_surface());
                let before = map.non_exclusive_zone();
                map.unmap_layer(&layer);
                let changed = map.non_exclusive_zone() != before;
                drop(map);
                if changed {
                    self.ipc.emit("outputs-changed", serde_json::json!({}));
                }
            }
        }
        if had_focus {
            self.focus_topmost();
        }
    }
}

delegate_layer_shell!(Dashi);

/// On every commit: lay the screen's layers out again, send the first
/// configure, and give the keyboard to a surface that takes it exclusively.
pub(crate) fn handle_commit(state: &mut Dashi, surface: &WlSurface) {
    let Some(output) = state.space.outputs().find(|output| {
        layer_map_for_output(output)
            .layer_for_surface(surface, WindowSurfaceType::TOPLEVEL)
            .is_some()
    }) else {
        return;
    };
    let output = output.clone();
    let initial_configure_sent = with_states(surface, |states| {
        states
            .data_map
            .get::<LayerSurfaceData>()
            .and_then(|data| data.lock().ok())
            .is_some_and(|data| data.initial_configure_sent)
    });
    let mut map = layer_map_for_output(&output);
    let before = map.non_exclusive_zone();
    map.arrange();
    let zone_changed = map.non_exclusive_zone() != before;
    let layer = map
        .layer_for_surface(surface, WindowSurfaceType::TOPLEVEL)
        .cloned();
    drop(map);
    let Some(layer) = layer else { return };
    if !initial_configure_sent {
        layer.layer_surface().send_configure();
    }
    if zone_changed {
        state.ipc.emit("outputs-changed", serde_json::json!({}));
    }
    let exclusive = layer.cached_state().keyboard_interactivity == KeyboardInteractivity::Exclusive;
    if exclusive
        && initial_configure_sent
        && !state.has_keyboard(surface)
        && let Some(keyboard) = state.seat.get_keyboard()
    {
        keyboard.set_focus(state, Some(surface.clone()), SERIAL_COUNTER.next_serial());
    }
}

impl Dashi {
    pub(crate) fn has_keyboard(&self, surface: &WlSurface) -> bool {
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| &focus == surface)
    }

    /// The screen the pointer is on, else the first.
    pub(crate) fn output_under_pointer(&self) -> Option<Output> {
        let pointer = self.seat.get_pointer()?.current_location();
        self.space
            .output_under(pointer)
            .next()
            .or_else(|| self.space.outputs().next())
            .cloned()
    }
}
