//! dashi-comp as Xwayland's window manager: X11 windows into the registry and
//! onto the screen, their requests to the shell, and the selections both ways.

use std::os::fd::OwnedFd;

use serde_json::json;
use smithay::{
    desktop::Window,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Rectangle, SERIAL_COUNTER},
    wayland::{
        selection::{
            SelectionTarget,
            data_device::{
                clear_data_device_selection, current_data_device_selection_userdata,
                request_data_device_client_selection, set_data_device_selection,
            },
            primary_selection::{
                clear_primary_selection, current_primary_selection_userdata,
                request_primary_client_selection, set_primary_selection,
            },
        },
        xwayland_shell::{XWaylandShellHandler, XWaylandShellState},
    },
    xwayland::{
        X11Surface, X11Wm, XwmHandler,
        xwm::{Reorder, ResizeEdge as X11ResizeEdge, XwmId},
    },
};

use crate::state::Dashi;

impl Dashi {
    fn x11_id(&self, surface: &X11Surface) -> Option<crate::wm::WindowId> {
        self.windows
            .entries()
            .find(|e| e.window.x11_surface() == Some(surface))
            .map(|e| e.id)
    }

    fn x11_mapped(&self, surface: &X11Surface) -> Option<Window> {
        self.space
            .elements()
            .find(|w| w.x11_surface() == Some(surface))
            .cloned()
    }
}

impl XWaylandShellHandler for Dashi {
    fn xwayland_shell_state(&mut self) -> &mut XWaylandShellState {
        &mut self.xwayland_shell_state
    }

    // The surface may have drawn before Xwayland said whose it is.
    fn surface_associated(&mut self, _xwm: XwmId, wl_surface: WlSurface, _surface: X11Surface) {
        self.place_when_drawn(&wl_surface);
    }
}

smithay::delegate_xwayland_shell!(Dashi);

impl XwmHandler for Dashi {
    fn xwm_state(&mut self, _xwm: XwmId) -> &mut X11Wm {
        match self.xwayland.wm.as_mut() {
            Some(wm) => wm,
            // Only called from an X11Wm's own events, which exist only while it does.
            None => unreachable!("an X11 window manager event without one"),
        }
    }

    fn new_window(&mut self, _xwm: XwmId, _window: X11Surface) {}
    fn new_override_redirect_window(&mut self, _xwm: XwmId, _window: X11Surface) {}

    fn map_window_request(&mut self, _xwm: XwmId, surface: X11Surface) {
        if let Err(error) = surface.set_mapped(true) {
            tracing::debug!(?error, "mapping an X11 window");
            return;
        }
        if self.x11_id(&surface).is_some() {
            return;
        }
        // Its own title bar unless it draws one (Motif hints) or is a menu-like window.
        let decor = if surface.is_decorated() || surface.is_popup() {
            crate::render::titlebar::Decor::None
        } else {
            crate::render::titlebar::Decor::Standard
        };
        let id = self.windows.add(Window::new_x11_window(surface));
        if let Some(entry) = self.windows.get_mut(id) {
            entry.decor = decor;
        }
        // Placed once its Wayland surface has drawn, as xdg windows are (place_when_drawn).
    }

    fn mapped_override_redirect_window(&mut self, _xwm: XwmId, surface: X11Surface) {
        let at = surface.geometry().loc;
        self.space
            .map_element(Window::new_x11_window(surface), at, false);
    }

    fn unmapped_window(&mut self, _xwm: XwmId, surface: X11Surface) {
        if let Some(window) = self.x11_mapped(&surface) {
            self.space.unmap_elem(&window);
        }
        if let Some(id) = self.x11_id(&surface) {
            self.window_gone(id);
        }
        if !surface.is_override_redirect() {
            let _ = surface.set_mapped(false);
        }
    }

    fn destroyed_window(&mut self, _xwm: XwmId, surface: X11Surface) {
        if let Some(window) = self.x11_mapped(&surface) {
            self.space.unmap_elem(&window);
        }
        if let Some(id) = self.x11_id(&surface) {
            self.window_gone(id);
        }
    }

    fn configure_request(
        &mut self,
        _xwm: XwmId,
        surface: X11Surface,
        _x: Option<i32>,
        _y: Option<i32>,
        w: Option<u32>,
        h: Option<u32>,
        _reorder: Option<Reorder>,
    ) {
        // An X11 app may size itself; where it goes is the shell's.
        let mut geometry = surface.geometry();
        if let Some(w) = w {
            geometry.size.w = (w as i32).clamp(1, 1 << 15);
        }
        if let Some(h) = h {
            geometry.size.h = (h as i32).clamp(1, 1 << 15);
        }
        let _ = surface.configure(geometry);
    }

    fn configure_notify(
        &mut self,
        _xwm: XwmId,
        surface: X11Surface,
        geometry: Rectangle<i32, Logical>,
        _above: Option<u32>,
    ) {
        // Override-redirect windows (menus) move themselves.
        if surface.is_override_redirect()
            && let Some(window) = self.x11_mapped(&surface)
        {
            self.space.map_element(window, geometry.loc, false);
        }
    }

    fn maximize_request(&mut self, _xwm: XwmId, surface: X11Surface) {
        self.ask_shell_x11(&surface, "zoom", true);
    }

    fn unmaximize_request(&mut self, _xwm: XwmId, surface: X11Surface) {
        self.ask_shell_x11(&surface, "zoom", false);
    }

    fn fullscreen_request(&mut self, _xwm: XwmId, surface: X11Surface) {
        self.ask_shell_x11(&surface, "fullscreen", true);
    }

    fn unfullscreen_request(&mut self, _xwm: XwmId, surface: X11Surface) {
        self.ask_shell_x11(&surface, "fullscreen", false);
    }

    fn resize_request(
        &mut self,
        _xwm: XwmId,
        surface: X11Surface,
        button: u32,
        edges: X11ResizeEdge,
    ) {
        use crate::wm::grabs::{ResizeEdge, ResizeSurfaceGrab};
        let (Some(window), Some(pointer)) = (self.x11_mapped(&surface), self.seat.get_pointer())
        else {
            return;
        };
        let Some(at) = self.space.element_location(&window) else {
            return;
        };
        let edges = match edges {
            X11ResizeEdge::Top => ResizeEdge::TOP,
            X11ResizeEdge::Bottom => ResizeEdge::BOTTOM,
            X11ResizeEdge::Left => ResizeEdge::LEFT,
            X11ResizeEdge::Right => ResizeEdge::RIGHT,
            X11ResizeEdge::TopLeft => ResizeEdge::TOP_LEFT,
            X11ResizeEdge::TopRight => ResizeEdge::TOP_RIGHT,
            X11ResizeEdge::BottomLeft => ResizeEdge::BOTTOM_LEFT,
            X11ResizeEdge::BottomRight => ResizeEdge::BOTTOM_RIGHT,
        };
        let start = smithay::input::pointer::GrabStartData {
            focus: None,
            button,
            location: pointer.current_location(),
        };
        let rect = Rectangle::new(at, surface.geometry().size);
        let grab = ResizeSurfaceGrab::start(start, window, edges, rect);
        pointer.set_grab(
            self,
            grab,
            SERIAL_COUNTER.next_serial(),
            smithay::input::pointer::Focus::Clear,
        );
    }

    fn move_request(&mut self, _xwm: XwmId, surface: X11Surface, button: u32) {
        let (Some(window), Some(pointer)) = (self.x11_mapped(&surface), self.seat.get_pointer())
        else {
            return;
        };
        let at = pointer.current_location();
        self.start_move(window, at, button, SERIAL_COUNTER.next_serial());
    }

    fn allow_selection_access(&mut self, _xwm: XwmId, _selection: SelectionTarget) -> bool {
        // Only an X11 app with the keyboard reads the clipboard.
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| {
                self.windows
                    .by_surface(&focus)
                    .is_some_and(|e| e.window.x11_surface().is_some())
            })
    }

    fn send_selection(
        &mut self,
        _xwm: XwmId,
        selection: SelectionTarget,
        mime_type: String,
        fd: OwnedFd,
    ) {
        let result = match selection {
            SelectionTarget::Clipboard => {
                request_data_device_client_selection(&self.seat, mime_type, fd)
                    .map_err(|e| format!("{e:?}"))
            }
            SelectionTarget::Primary => request_primary_client_selection(&self.seat, mime_type, fd)
                .map_err(|e| format!("{e:?}")),
        };
        if let Err(error) = result {
            tracing::debug!(error, "handing the Wayland selection to an X11 app");
        }
    }

    fn new_selection(&mut self, _xwm: XwmId, selection: SelectionTarget, mime_types: Vec<String>) {
        match selection {
            SelectionTarget::Clipboard => {
                set_data_device_selection(&self.display_handle, &self.seat, mime_types, ())
            }
            SelectionTarget::Primary => {
                set_primary_selection(&self.display_handle, &self.seat, mime_types, ())
            }
        }
    }

    fn cleared_selection(&mut self, _xwm: XwmId, selection: SelectionTarget) {
        match selection {
            SelectionTarget::Clipboard
                if current_data_device_selection_userdata(&self.seat).is_some() =>
            {
                clear_data_device_selection(&self.display_handle, &self.seat)
            }
            SelectionTarget::Primary
                if current_primary_selection_userdata(&self.seat).is_some() =>
            {
                clear_primary_selection(&self.display_handle, &self.seat)
            }
            _ => {}
        }
    }
}

impl Dashi {
    fn ask_shell_x11(&mut self, surface: &X11Surface, event: &str, on: bool) {
        let Some(id) = self
            .x11_id(surface)
            .filter(|id| self.windows.get(*id).is_some_and(|e| e.announced))
        else {
            return;
        };
        let payload = if event == "fullscreen" {
            json!({ "window": id, "on": on })
        } else {
            json!({ "window": id })
        };
        self.ipc.emit(event, payload);
    }
}
