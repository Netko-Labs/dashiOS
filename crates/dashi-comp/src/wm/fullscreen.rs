//! Full screen (`fullscreen {window, on}`): the window covers its whole
//! screen, over the menu bar and Dock, and gets its frame back after. While
//! a screen has one, its top layers (the menu bar, the Dock) are neither drawn
//! nor pressed, unless the shell brings them out (`bars {show}`). The edge
//! band (`bars {top}`) tells the shell when the pointer reaches the top.

use serde_json::json;
use smithay::{
    desktop::Window,
    output::Output,
    reexports::wayland_protocols::xdg::shell::server::xdg_toplevel,
    reexports::wayland_server::Resource,
    utils::{Logical, Point, Rectangle, Size},
};

use super::windows::{Shown, WindowId, frame_of};
use crate::state::Dashi;

/// The shell's claim on the top edge, and where it brought the bars out.
#[derive(Default)]
pub(crate) struct Bars {
    /// The band's height along every screen's top edge; 0 is no band.
    pub top: i32,
    /// The pointer is in the band (on this screen).
    inside: Option<String>,
    /// The bars are out: on one screen, or on all ("").
    pub shown: Option<String>,
}

impl Dashi {
    /// `fullscreen {window, on}`.
    pub(crate) fn set_fullscreen(&mut self, id: WindowId, on: bool) -> Result<(), String> {
        let entry = self
            .windows
            .get(id)
            .filter(|e| e.announced)
            .ok_or_else(|| format!("no window {id}"))?;
        let window = entry.window.clone();
        if on == entry.fullscreen.is_some() {
            return Ok(());
        }
        // A window waiting on a Space that is not shown is full screen there
        // when it shows (the shell moves a window to its own Desktop first).
        let away = entry.shown == Shown::Normal && self.waits_off_screen(id);
        if on {
            let frame = if away {
                self.away_frame(id)
            } else {
                frame_of(self, &window)
            }
            .ok_or("the window is not on screen")?;
            let center = frame.loc.to_f64() + frame.size.to_f64().downscale(2.0).to_point();
            let output = self
                .space
                .output_under(center)
                .next()
                .or_else(|| self.space.outputs().next())
                .cloned()
                .ok_or("no screen")?;
            let screen = self.space.output_geometry(&output).ok_or("no screen")?;
            if let Some(entry) = self.windows.get_mut(id) {
                entry.fullscreen = Some((output.name(), frame));
                // Its title bar goes; a unified window's lights stay (wm/decor.rs).
                if !entry.decor.drawn(true) {
                    entry.title_image = None;
                }
                entry.tiled = false;
            }
            configure(&window, Some(screen.size), Some(&output));
            super::actions::x11_follow(&window, screen.loc);
            if away {
                if let Some(entry) = self.windows.get_mut(id) {
                    entry.away_at = Some(screen.loc);
                }
            } else {
                self.space.map_element(window.clone(), screen.loc, true);
                self.space.raise_element(&window, true);
            }
        } else {
            let restore = self
                .windows
                .get_mut(id)
                .and_then(|entry| entry.fullscreen.take())
                .map(|(_, frame)| frame);
            let bar = self.bar_height(&window);
            configure(
                &window,
                restore.map(|frame| Size::from((frame.size.w, (frame.size.h - bar).max(1)))),
                None,
            );
            if let Some(frame) = restore {
                // Off screen (on another Space, minimized, hidden), it comes back there.
                if self.waits_off_screen(id) {
                    self.wait_at(id, frame.loc);
                } else {
                    self.space
                        .map_element(window.clone(), (frame.loc.x, frame.loc.y + bar), true);
                }
            }
        }
        self.ipc.emit("outputs-changed", json!({}));
        Ok(())
    }

    /// The outer frame of a window waiting on a Space that is not shown, where it will show.
    fn away_frame(&self, id: WindowId) -> Option<Rectangle<i32, Logical>> {
        let entry = self.windows.get(id)?;
        let at = entry.away_at?;
        let bar = self.bar_height(&entry.window);
        let size = entry.window.geometry().size;
        Some(Rectangle::new(
            (at.x, at.y - bar).into(),
            (size.w, size.h + bar).into(),
        ))
    }

    /// The window that is full screen on `output` and showing, if any.
    pub(crate) fn fullscreen_on(&self, output: &Output) -> Option<Window> {
        let name = output.name();
        self.space
            .elements()
            .rev()
            .find(|window| {
                self.windows.by_window(window).is_some_and(|e| {
                    e.shown == Shown::Normal
                        && e.fullscreen.as_ref().is_some_and(|(on, _)| on == &name)
                })
            })
            .cloned()
    }

    /// Whether `output`'s top layers (menu bar, Dock) show: not under a full-screen window, unless brought out.
    pub(crate) fn shows_top_layers(&self, output: &Output) -> bool {
        if self.fullscreen_on(output).is_none() {
            return true;
        }
        self.bars
            .shown
            .as_ref()
            .is_some_and(|on| on.is_empty() || on == &output.name())
    }

    /// The height of the title bar dashi-comp draws above `window` now (none in full screen).
    pub(crate) fn bar_height(&self, window: &Window) -> i32 {
        self.windows
            .by_window(window)
            .filter(|entry| entry.fullscreen.is_none())
            .map(|entry| entry.decor.bar_height())
            .unwrap_or(0)
    }

    /// `bars {top}` and `bars {show, output?}`.
    pub(crate) fn set_bars(&mut self, top: Option<i32>, show: Option<(bool, Option<String>)>) {
        if let Some(top) = top {
            self.bars.top = top.clamp(0, 200);
            if self.bars.top == 0 {
                self.bars.inside = None;
            }
        }
        if let Some((show, output)) = show {
            self.bars.shown = show.then(|| output.unwrap_or_default());
        }
    }

    /// After the pointer moves: tell the shell when it enters or leaves the top band.
    pub(crate) fn watch_bars(&mut self, at: Point<f64, Logical>) {
        if self.bars.top == 0 {
            return;
        }
        let output = self.space.output_under(at).next().cloned();
        let inside = output.as_ref().and_then(|output| {
            let screen = self.space.output_geometry(output)?;
            (at.y - f64::from(screen.loc.y) < f64::from(self.bars.top)).then(|| output.name())
        });
        if inside == self.bars.inside {
            return;
        }
        let event = match &inside {
            Some(name) => json!({ "inside": true, "output": name }),
            None => json!({ "inside": false }),
        };
        self.bars.inside = inside;
        self.ipc.emit("bars-edge", event);
    }
}

/// Tell the client its size and whether it is full screen (on `output`).
fn configure(window: &Window, size: Option<Size<i32, Logical>>, fullscreen_on: Option<&Output>) {
    if let Some(x11) = window.x11_surface() {
        let _ = x11.set_fullscreen(fullscreen_on.is_some());
        if let Some(size) = size {
            let _ = x11.configure(Rectangle::new(x11.geometry().loc, size));
        }
        return;
    }
    let Some(toplevel) = window.toplevel() else {
        return;
    };
    let client = toplevel.wl_surface().client();
    toplevel.with_pending_state(|state| {
        state.size = size;
        if let Some(output) = fullscreen_on {
            state.states.set(xdg_toplevel::State::Fullscreen);
            state.fullscreen_output = client
                .as_ref()
                .and_then(|client| output.client_outputs(client).next());
        } else {
            state.states.unset(xdg_toplevel::State::Fullscreen);
            state.fullscreen_output = None;
        }
    });
    toplevel.send_pending_configure();
}
