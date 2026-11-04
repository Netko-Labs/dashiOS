//! How each window is framed, and the title bar images that go with it. A
//! window gets dashi-comp's title bar when its decorations are server side
//! (xdg-decoration), the traffic lights alone when it also asked for the
//! unified style (dashi-chrome-v1), and nothing when it draws its own.

use smithay::{
    reexports::{
        wayland_protocols::xdg::decoration::zv1::server::zxdg_toplevel_decoration_v1::Mode as DecorationMode,
        wayland_server::protocol::wl_surface::WlSurface,
    },
    wayland::shell::xdg::ToplevelSurface,
};

use crate::{
    protocols::dashi_chrome,
    render::titlebar::{self, CONTROLS, Decor, Look},
    state::Dashi,
};

/// What the shell sets with `chrome`: Dark Mode for the title bars, the corner radius, Reduce Motion.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ChromeStyle {
    pub dark: bool,
    pub radius: i32,
    pub reduce_motion: bool,
}

impl Default for ChromeStyle {
    fn default() -> Self {
        Self {
            dark: false,
            radius: 10,
            reduce_motion: false,
        }
    }
}

fn decor_for(toplevel: &ToplevelSurface, unified: bool) -> Decor {
    let server_side = toplevel.current_state().decoration_mode == Some(DecorationMode::ServerSide);
    match (server_side, unified) {
        (false, _) => Decor::None,
        (true, false) => Decor::Standard,
        (true, true) => Decor::Unified,
    }
}

impl Dashi {
    /// After a commit or a style change: the window's framing, as it now stands.
    pub(crate) fn update_decor(&mut self, surface: &WlSurface) {
        let Some(entry) = self.windows.by_surface_mut(surface) else {
            return;
        };
        let Some(toplevel) = entry.window.toplevel().cloned() else {
            return;
        };
        let decor = decor_for(&toplevel, entry.unified);
        if decor == entry.decor {
            return;
        }
        let was_unified = entry.decor == Decor::Unified;
        entry.decor = decor;
        entry.title_image = None;
        if was_unified != (decor == Decor::Unified) {
            self.send_controls(surface);
        }
    }

    /// dashi-chrome-v1 `set_style` (or the object's destruction).
    pub(crate) fn set_unified(&mut self, surface: &WlSurface, unified: bool) {
        if let Some(entry) = self.windows.by_surface_mut(surface) {
            entry.unified = unified;
        }
        self.update_decor(surface);
        self.send_controls(surface);
    }

    fn send_controls(&self, surface: &WlSurface) {
        let unified = self
            .windows
            .by_surface(surface)
            .is_some_and(|entry| entry.decor == Decor::Unified);
        for (_, chrome) in self.chrome_objects.iter().filter(|(s, _)| s == surface) {
            dashi_chrome::send_controls(chrome, unified.then_some(CONTROLS));
        }
    }

    /// Draw again the title bars whose look changed (before a frame is rendered).
    pub(crate) fn refresh_decorations(&mut self, scale: i32) {
        let focus = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus());
        let style = self.chrome_style;
        let Dashi { windows, text, .. } = self;
        for entry in windows.entries_mut() {
            if entry.decor == Decor::None || entry.fullscreen.is_some() {
                entry.title_image = None;
                continue;
            }
            let surface = super::toplevel_surface(&entry.window);
            let look = Look {
                decor: entry.decor,
                width: entry.window.geometry().size.w,
                title: super::names(&entry.window).1,
                active: focus.is_some() && focus == surface,
                dark: style.dark,
                radius: style.radius,
                scale: scale.max(1),
                hover: entry.hover,
            };
            if entry
                .title_image
                .as_ref()
                .is_some_and(|image| image.look == look)
            {
                continue;
            }
            let buffer = titlebar::draw(&look, text);
            entry.title_image = Some(titlebar::Image { look, buffer });
        }
    }
}
