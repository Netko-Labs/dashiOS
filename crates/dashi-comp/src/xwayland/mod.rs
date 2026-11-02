//! Xwayland: X11 apps, as windows like the others. dashi-comp starts the X
//! server (restarting it if it dies) and is its window manager through
//! smithay's X11Wm. X11 windows are placed by the shell like any window
//! (`window-placing`, with the spot the app asked for), report `x11: true`,
//! and share the clipboard and primary selection with Wayland apps. Menus and
//! tooltips (override-redirect windows) go where the app puts them.

use std::{os::fd::OwnedFd, process::Stdio, time::Duration};

use serde_json::json;
use smithay::{
    desktop::Window,
    reexports::calloop::timer::{TimeoutAction, Timer},
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
        X11Surface, X11Wm, XWayland, XWaylandEvent, XwmHandler,
        xwm::{Reorder, ResizeEdge as X11ResizeEdge, XwmId},
    },
};

use crate::state::Dashi;

/// Xwayland that dies is started again, after waiting longer each time.
const RESTART_AFTER: [u64; 4] = [1, 2, 5, 15];

/// Where Xwayland is, as `session` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum XState {
    #[default]
    Off,
    Starting,
    Ready,
    Failed,
}

impl XState {
    pub(crate) fn name(self) -> &'static str {
        match self {
            XState::Off => "off",
            XState::Starting => "starting",
            XState::Ready => "ready",
            XState::Failed => "failed",
        }
    }
}

#[derive(Default)]
pub(crate) struct Xwayland {
    pub state: XState,
    /// The X display apps reach it on, while it runs.
    pub display: Option<u32>,
    /// The display number it was given, kept for restarts.
    pub number: Option<u32>,
    pub wm: Option<X11Wm>,
    /// The X11 window with the keyboard.
    focused: Option<X11Surface>,
    restarts: usize,
}

impl Dashi {
    /// Start Xwayland; when it is ready the shell hears `session-changed`.
    pub(crate) fn start_xwayland(&mut self) {
        // The same display number after a restart, so apps' DISPLAY stays right.
        let spawned = XWayland::spawn(
            &self.display_handle,
            self.xwayland.number,
            std::iter::empty::<(String, String)>(),
            true,
            Stdio::null(),
            Stdio::null(),
            |_| (),
        );
        let (xwayland, client) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
                tracing::warn!(%error, "Xwayland did not start; X11 apps will not run");
                self.xwayland.state = XState::Failed;
                return;
            }
        };
        self.xwayland.state = XState::Starting;
        // The socket is listening already: X clients may connect before it is ready.
        self.xwayland.number = Some(xwayland.display_number());
        self.xwayland.display = self.xwayland.number;
        let inserted =
            self.loop_handle
                .insert_source(xwayland, move |event, _, state| match event {
                    XWaylandEvent::Ready {
                        x11_socket,
                        display_number,
                    } => {
                        match X11Wm::start_wm(state.loop_handle.clone(), x11_socket, client.clone())
                        {
                            Ok(wm) => {
                                state.xwayland.wm = Some(wm);
                                state.xwayland.display = Some(display_number);
                                state.xwayland.state = XState::Ready;
                                state.xwayland.restarts = 0;
                                tracing::info!(display = display_number, "Xwayland is ready");
                            }
                            Err(error) => {
                                tracing::warn!(%error, "no X11 window manager");
                                state.xwayland.state = XState::Failed;
                            }
                        }
                        state.ipc.emit("session-changed", json!({}));
                    }
                    XWaylandEvent::Error => {
                        tracing::warn!("Xwayland stopped");
                        state.xwayland_gone();
                    }
                });
        if inserted.is_err() {
            self.xwayland.state = XState::Failed;
        }
    }

    /// Xwayland died: say so, and start it again a little later.
    fn xwayland_gone(&mut self) {
        self.xwayland.wm = None;
        self.xwayland.display = None;
        self.xwayland.state = XState::Failed;
        self.ipc.emit("session-changed", json!({}));
        let wait = RESTART_AFTER[self.xwayland.restarts.min(RESTART_AFTER.len() - 1)];
        self.xwayland.restarts += 1;
        let _ = self.loop_handle.insert_source(
            Timer::from_duration(Duration::from_secs(wait)),
            |_, _, state| {
                if state.xwayland.state == XState::Failed {
                    state.start_xwayland();
                }
                TimeoutAction::Drop
            },
        );
    }

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

impl Dashi {
    /// The keyboard moved: an X11 window gets the X input focus with it
    /// (Xwayland sends keys to the X focus, which only the WM sets).
    pub(crate) fn x11_focus(&mut self, focused: Option<&WlSurface>) {
        use smithay::input::keyboard::KeyboardTarget;
        let x11 = focused
            .and_then(|surface| self.windows.by_surface(surface))
            .and_then(|entry| entry.window.x11_surface().cloned());
        if self.xwayland.focused == x11 {
            return;
        }
        if let Some(previous) = self.xwayland.focused.take() {
            let _ = previous.set_activated(false);
        }
        let Some(x11) = x11 else { return };
        let _ = x11.set_activated(true);
        if let Some(wm) = self.xwayland.wm.as_mut() {
            let _ = wm.raise_window(&x11);
        }
        // X11Surface's own enter sets the X focus (or sends WM_TAKE_FOCUS) and
        // repeats wl_keyboard.enter on its surface, which Xwayland takes as is.
        let seat = self.seat.clone();
        KeyboardTarget::enter(&x11, &seat, self, Vec::new(), SERIAL_COUNTER.next_serial());
        self.xwayland.focused = Some(x11);
    }
}
