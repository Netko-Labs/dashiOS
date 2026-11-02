//! Presses on what dashi-comp draws round a window: the traffic lights (close,
//! minimize, full screen or, with ⌥, zoom) and the title bar (drag to move,
//! double-click to zoom). They never reach the client. Full screen and zoom
//! are the shell's to decide: the compositor only tells it (`fullscreen`, `zoom`).

use std::time::{Duration, Instant};

use serde_json::json;
use smithay::{
    desktop::{Window, layer_map_for_output},
    input::pointer::{Focus, GrabStartData},
    utils::{Logical, Point, Serial},
    wayland::shell::wlr_layer::Layer,
};

use crate::{
    render::titlebar::{Decor, Part, part_at},
    state::Dashi,
    wm::{Shown, frame_of, grabs::MoveSurfaceGrab},
};

/// Two presses on a title bar this close together are a double-click.
const DOUBLE_CLICK: Duration = Duration::from_millis(400);

impl Dashi {
    /// The window decoration at `pos`, when it is the topmost thing there.
    pub(crate) fn decoration_at(&self, pos: Point<f64, Logical>) -> Option<(u64, Window, Part)> {
        if let Some(output) = self.space.output_under(pos).next() {
            let origin = self.space.output_geometry(output)?.loc.to_f64();
            let layers = layer_map_for_output(output);
            if [Layer::Overlay, Layer::Top]
                .into_iter()
                .any(|layer| layers.layer_under(layer, pos - origin).is_some())
            {
                return None;
            }
        }
        for window in self.space.elements().rev() {
            let Some(entry) = self
                .windows
                .by_window(window)
                .filter(|entry| entry.announced)
            else {
                continue;
            };
            let Some(frame) = frame_of(self, window) else {
                continue;
            };
            if !frame.to_f64().contains(pos) {
                continue;
            }
            if entry.decor == Decor::None {
                return None;
            }
            let at = pos - frame.loc.to_f64();
            return part_at(at.x, at.y, frame.size.w, entry.decor)
                .map(|part| (entry.id, window.clone(), part));
        }
        None
    }

    /// A press on a decoration: what it does. True when one was there.
    pub(crate) fn press_decoration(
        &mut self,
        pos: Point<f64, Logical>,
        button: u32,
        serial: Serial,
    ) -> bool {
        let Some((id, window, part)) = self.decoration_at(pos) else {
            return false;
        };
        let alt = self
            .seat
            .get_keyboard()
            .is_some_and(|keyboard| keyboard.modifier_state().alt);
        let result = match part {
            Part::Close => self.close_window(id),
            Part::Minimize => self.park_window(id, Shown::Minimized),
            Part::Zoom if alt => {
                self.ipc.emit("zoom", json!({ "window": id }));
                Ok(())
            }
            Part::Zoom => {
                self.ipc
                    .emit("fullscreen", json!({ "window": id, "on": true }));
                Ok(())
            }
            Part::Bar => {
                let double = self
                    .last_bar_press
                    .take()
                    .is_some_and(|(last, at)| last == id && at.elapsed() < DOUBLE_CLICK);
                let focused = self.focus_window(id);
                if double {
                    self.ipc.emit("zoom", json!({ "window": id }));
                } else {
                    self.last_bar_press = Some((id, Instant::now()));
                    self.start_move(window, pos, button, serial);
                }
                focused
            }
        };
        if let Err(error) = result {
            tracing::debug!(%error, "a press on a window's decoration");
        }
        true
    }

    /// A press away from any decoration: the keyboard goes to what was pressed.
    /// A layer that takes no keyboard (the Dock) leaves it where it was.
    pub(crate) fn focus_at(&mut self, at: Point<f64, Logical>, serial: Serial) {
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        let top_layer = self
            .space
            .output_under(at)
            .next()
            .cloned()
            .and_then(|output| {
                let origin = self.space.output_geometry(&output)?.loc.to_f64();
                let layers = layer_map_for_output(&output);
                [Layer::Overlay, Layer::Top]
                    .into_iter()
                    .find_map(|layer| layers.layer_under(layer, at - origin).cloned())
            });
        if let Some(layer) = top_layer {
            if layer.can_receive_keyboard_focus() {
                keyboard.set_focus(self, Some(layer.wl_surface().clone()), serial);
            }
            return;
        }
        let window = self
            .space
            .element_under(at)
            .map(|(window, _)| window.clone());
        match window.and_then(|window| self.windows.by_window(&window).map(|entry| entry.id)) {
            Some(id) => {
                let _ = self.focus_window(id);
            }
            None => {
                self.space.elements().for_each(|window| {
                    window.set_activated(false);
                });
                keyboard.set_focus(self, None, serial);
                self.configure_all();
            }
        }
    }

    /// Whether a shown top or overlay layer surface is under `at` (the menu bar, the Dock, the shell's sheets).
    pub(crate) fn top_layer_at(&self, at: Point<f64, Logical>) -> bool {
        let Some(output) = self.space.output_under(at).next() else {
            return false;
        };
        let Some(origin) = self.space.output_geometry(output).map(|g| g.loc.to_f64()) else {
            return false;
        };
        let top = self.shows_top_layers(output);
        let layers = layer_map_for_output(output);
        [Layer::Overlay, Layer::Top]
            .into_iter()
            .filter(|layer| top || *layer == Layer::Overlay)
            .any(|layer| layers.layer_under(layer, at - origin).is_some())
    }

    fn start_move(
        &mut self,
        window: Window,
        pos: Point<f64, Logical>,
        button: u32,
        serial: Serial,
    ) {
        let (Some(pointer), Some(initial_window_location)) = (
            self.seat.get_pointer(),
            self.space.element_location(&window),
        ) else {
            return;
        };
        let start_data = GrabStartData {
            focus: None,
            button,
            location: pos,
        };
        let grab = MoveSurfaceGrab {
            start_data,
            window,
            initial_window_location,
        };
        pointer.set_grab(self, grab, serial, Focus::Clear);
    }
}
