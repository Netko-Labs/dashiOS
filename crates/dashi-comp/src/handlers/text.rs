//! Typing beyond the keyboard: text-input (a text field tells where the caret
//! is) and input-method (an IME such as fcitx5 or IBus composes text for it),
//! and virtual-keyboard (an on-screen keyboard). An input method sees what is
//! typed and a virtual keyboard types anywhere, so only the shell's processes
//! (what the session starts) may bind them, and none in greeter mode.
//!
//! An input method's candidate popup goes under the caret the field reports,
//! above it when there is no room below, and never off its screen, in a
//! window or on a layer surface (the launcher, a sheet) alike; it moves with
//! the caret and as it grows.

use std::sync::{Arc, atomic::AtomicI32};

use smithay::{
    delegate_input_method_manager, delegate_text_input_manager, delegate_virtual_keyboard_manager,
    desktop::{
        PopupKind, PopupManager, WindowSurfaceType, layer_map_for_output,
        utils::bbox_from_surface_tree,
    },
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    utils::{Logical, Point, Rectangle, Size},
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

/// Where a candidate popup `size` big goes, in its parent surface's
/// coordinates: under `caret` (the text field's cursor rectangle, in the same
/// coordinates), above it when it would run off the bottom of `screen`, and
/// moved in from the screen's edges. `origin` is where the parent surface's
/// (0, 0) is on the screen (global logical).
pub(crate) fn below_caret(
    caret: Rectangle<i32, Logical>,
    origin: Point<i32, Logical>,
    size: Size<i32, Logical>,
    screen: Rectangle<i32, Logical>,
) -> Point<i32, Logical> {
    let bottom = screen.loc.y + screen.size.h;
    let right = screen.loc.x + screen.size.w;
    let under = origin.y + caret.loc.y + caret.size.h;
    let y = if under + size.h > bottom && origin.y + caret.loc.y - size.h >= screen.loc.y {
        caret.loc.y - size.h
    } else {
        caret.loc.y + caret.size.h
    };
    let x = (origin.x + caret.loc.x)
        .min(right - size.w)
        .max(screen.loc.x)
        - origin.x;
    (x, y).into()
}

impl Dashi {
    /// Where `surface` (a window's or a layer surface's) has its (0, 0) on
    /// screen, and that screen's rect.
    fn surface_on_screen(
        &self,
        surface: &WlSurface,
    ) -> Option<(Point<i32, Logical>, Rectangle<i32, Logical>)> {
        if let Some(window) = self
            .space
            .elements()
            .find(|window| window.wl_surface().as_deref() == Some(surface))
        {
            let at = self.space.element_location(window)? - window.geometry().loc;
            let output = self.space.outputs_for_element(window).into_iter().next()?;
            return Some((at, self.space.output_geometry(&output)?));
        }
        self.space.outputs().find_map(|output| {
            let screen = self.space.output_geometry(output)?;
            let map = layer_map_for_output(output);
            let layer = map.layer_for_surface(surface, WindowSurfaceType::TOPLEVEL)?;
            Some((screen.loc + map.layer_geometry(layer)?.loc, screen))
        })
    }

    /// A layer surface's own rect, at (0, 0): it has no window geometry.
    fn layer_rect(&self, surface: &WlSurface) -> Option<Rectangle<i32, Logical>> {
        self.space.outputs().find_map(|output| {
            let map = layer_map_for_output(output);
            let layer = map.layer_for_surface(surface, WindowSurfaceType::TOPLEVEL)?;
            Some(Rectangle::from_size(map.layer_geometry(layer)?.size))
        })
    }

    /// Put an input method's popup under its field's caret (`below_caret`).
    fn place_ime_popup(&self, popup: &PopupSurface) {
        let Some(parent) = popup.get_parent() else {
            return;
        };
        let Some((origin, screen)) = self.surface_on_screen(&parent.surface) else {
            return;
        };
        let size = bbox_from_surface_tree(popup.wl_surface(), (0, 0)).size;
        popup.set_location(below_caret(
            popup.text_input_rectangle(),
            origin,
            size,
            screen,
        ));
    }
}

/// A commit of an input method's popup: it may have grown, so it is placed again.
pub(crate) fn handle_commit(state: &Dashi, surface: &WlSurface) {
    if let Some(PopupKind::InputMethod(popup)) = state.popups.find_popup(surface) {
        state.place_ime_popup(&popup);
    }
}

impl InputMethodHandler for Dashi {
    fn new_popup(&mut self, surface: PopupSurface) {
        self.place_ime_popup(&surface);
        if let Err(error) = self.popups.track_popup(PopupKind::from(surface)) {
            tracing::debug!(?error, "an input method popup");
        }
    }

    fn popup_repositioned(&mut self, surface: PopupSurface) {
        self.place_ime_popup(&surface);
    }

    fn dismiss_popup(&mut self, surface: PopupSurface) {
        if let Some(parent) = surface.get_parent().map(|parent| parent.surface.clone()) {
            let _ = PopupManager::dismiss_popup(&parent, &PopupKind::from(surface));
        }
    }

    /// The parent's geometry in its own surface's coordinates: a window's
    /// (where its content starts), or a layer surface's whole rect.
    fn parent_geometry(&self, parent: &WlSurface) -> Rectangle<i32, Logical> {
        self.space
            .elements()
            .find(|window| window.wl_surface().as_deref() == Some(parent))
            .map(|window| window.geometry())
            .or_else(|| self.layer_rect(parent))
            .unwrap_or_default()
    }
}

delegate_text_input_manager!(Dashi);
delegate_input_method_manager!(Dashi);
delegate_virtual_keyboard_manager!(Dashi);

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Logical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    fn screen() -> Rectangle<i32, Logical> {
        rect(0, 0, 1600, 900)
    }

    #[test]
    fn the_candidates_go_under_the_caret() {
        // The launcher's field at (490, 120) on screen; its caret 60 in, 14 down, 20 tall.
        let at = below_caret(
            rect(60, 14, 2, 20),
            (490, 120).into(),
            (300, 40).into(),
            screen(),
        );
        assert_eq!(at, Point::from((60, 34)));
    }

    #[test]
    fn above_the_caret_at_the_bottom_and_in_from_the_right_edge() {
        let at = below_caret(
            rect(1500, 860, 2, 20),
            (0, 0).into(),
            (300, 120).into(),
            screen(),
        );
        assert_eq!(at, Point::from((1300, 740)));
    }

    #[test]
    fn a_second_screen_counts_from_its_own_edges() {
        let screen = rect(1600, 0, 1920, 1080);
        let at = below_caret(
            rect(-40, 10, 2, 20),
            (1620, 100).into(),
            (200, 40).into(),
            screen,
        );
        // Moved in to the screen's left edge, which is 20 left of the surface.
        assert_eq!(at, Point::from((-20, 30)));
    }
}
