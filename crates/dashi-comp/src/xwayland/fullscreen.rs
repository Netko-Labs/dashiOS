//! Full screen as X11 apps ask for it, and as they need it answered.
//!
//! An app may ask before the shell knows its window: with
//! `_NET_WM_STATE_FULLSCREEN` set on the window before it shows (SDL), with
//! the request sent right after it shows and before it has drawn (GLFW,
//! SDL), or, the old way, with a window that has no frame and is exactly
//! the size of a screen. Each is kept on the window and told to the shell
//! once it has heard `window-opened` (the `fullscreen` event, as for a
//! request made later).
//!
//! In full screen an X11 window is its screen as X11 sees it. A frame is
//! kept in whole points, and a screen at a fractional scale is no whole
//! number of them: 1920 by 1200 at 1.75 is 1097.1 by 685.7 points, which
//! dashi-comp rounds up to 1098 by 686 and X11Wm sent back as 1922 by 1201
//! pixels. The window is given the whole points nearest the screen's own
//! pixels instead (1097 by 686: 1920 by 1201), read from RandR. Only the
//! window manager's connection may size a window (another's request comes
//! back to it as a request), so a pixel of rounding is what is left.

use smithay::{
    desktop::Window,
    utils::{Logical, Rectangle, Size},
    xwayland::X11Surface,
};

use super::probe::screen_meant;
use crate::{ipc::protocol::Asked, state::Dashi, wm::WindowId};

impl Dashi {
    /// Before a new X11 window is placed: did it ask for full screen already?
    pub(crate) fn x11_note_fullscreen(&mut self, id: WindowId) {
        let Some(x11) = self
            .windows
            .get(id)
            .filter(|entry| !entry.placed && !entry.placing)
            .and_then(|entry| entry.window.x11_surface().cloned())
        else {
            return;
        };
        let Some(probe) = self.xwayland.probe.as_ref() else {
            return;
        };
        let frameless_screen = || {
            let (w, h) = probe.size(x11.window_id())?;
            let frameless = x11.is_decorated() && !x11.is_popup();
            (frameless && probe.screens().iter().any(|s| s.2 == w && s.3 == h)).then_some(())
        };
        if probe.says_fullscreen(x11.window_id()) || frameless_screen().is_some() {
            self.x11_size_for_fullscreen(id);
        }
    }

    /// The shell has just heard of window `id`: now it can hear what it asked for.
    pub(crate) fn x11_tell_fullscreen(&mut self, id: WindowId) {
        let asked = self
            .windows
            .get_mut(id)
            .is_some_and(|entry| std::mem::take(&mut entry.wants_fullscreen));
        if asked {
            self.ipc.emit(Asked::Fullscreen.event(id, true));
        }
    }

    /// The frame, in points, that makes X11 window `window` cover the screen
    /// at `screen` (points): the nearest to that screen's own pixels.
    pub(crate) fn x11_screen_frame(
        &self,
        window: &Window,
        screen: Rectangle<i32, Logical>,
    ) -> Rectangle<i32, Logical> {
        let scale = self.xwayland.scale;
        let meant = window
            .x11_surface()
            .and(self.xwayland.probe.as_ref())
            .and_then(|probe| screen_meant(&probe.screens(), pixels(screen, scale)));
        meant.map_or(screen, |pixels| points(pixels, scale))
    }

    /// An X11 window not yet shown asked for full screen: it is made the
    /// size of the screen under the pointer at once, and told it is full
    /// screen. A game sizes its picture when its window is made and waits a
    /// moment for this answer (SDL does; Neverball never looks again), long
    /// before the window has drawn and the shell can be asked. Where it
    /// goes, and whether it stays full screen, is still the shell's.
    pub(super) fn x11_size_for_fullscreen(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get_mut(id).filter(|entry| !entry.announced) else {
            return;
        };
        if std::mem::replace(&mut entry.wants_fullscreen, true) {
            return;
        }
        let window = entry.window.clone();
        let at = self.seat.get_pointer().map(|p| p.current_location());
        let output = at
            .and_then(|at| self.space.output_under(at).next())
            .or_else(|| self.space.outputs().next());
        let Some(screen) = output.and_then(|output| self.space.output_geometry(output)) else {
            return;
        };
        let frame = self.x11_screen_frame(&window, screen);
        if let Some(x11) = window.x11_surface() {
            let _ = x11.set_fullscreen(true);
            let _ = x11.configure(frame);
        }
    }

    /// An X11 app sizes its window while it is full screen (GLFW and SDL do
    /// as they leave it): that is the size it goes back to. True if taken.
    pub(super) fn x11_size_after_fullscreen(
        &mut self,
        surface: &X11Surface,
        w: Option<u32>,
        h: Option<u32>,
    ) -> bool {
        let Some(entry) = self
            .windows
            .entries_mut()
            .find(|entry| entry.window.x11_surface() == Some(surface))
        else {
            return false;
        };
        let bar = entry.decor.bar_height();
        let now = surface.geometry().size;
        let Some((_, frame)) = entry.fullscreen.as_mut() else {
            return false;
        };
        // Asking for the size it has (the screen's) says nothing about after.
        let same = |asked: Option<u32>, now: i32| asked.is_none_or(|v| (v as i32 - now).abs() <= 1);
        if !(same(w, now.w) && same(h, now.h)) {
            frame.size = after(*frame, bar, w, h);
        }
        true
    }
}

/// `rect` in X11's pixels, as X11Wm sends it: each side rounded.
fn pixels(rect: Rectangle<i32, Logical>, scale: f64) -> super::probe::Pixels {
    let px = |v: i32| (f64::from(v) * scale).round() as i32;
    (
        px(rect.loc.x),
        px(rect.loc.y),
        px(rect.size.w),
        px(rect.size.h),
    )
}

/// The whole points nearest `rect`, which is in X11's pixels.
fn points(rect: super::probe::Pixels, scale: f64) -> Rectangle<i32, Logical> {
    let pt = |v: i32| (f64::from(v) / scale).round() as i32;
    Rectangle::new(
        (pt(rect.0), pt(rect.1)).into(),
        (pt(rect.2).max(1), pt(rect.3).max(1)).into(),
    )
}

/// The outer frame's size to go back to, when the app asks for `w` by `h` inside it.
fn after(
    frame: Rectangle<i32, Logical>,
    bar: i32,
    w: Option<u32>,
    h: Option<u32>,
) -> Size<i32, Logical> {
    let side = |asked: Option<u32>, now: i32, extra: i32| {
        asked.map_or(now, |v| (v as i32).clamp(1, 1 << 15) + extra)
    };
    (side(w, frame.size.w, 0), side(h, frame.size.h, bar)).into()
}

#[cfg(test)]
mod tests {
    use super::{after, pixels, points};
    use smithay::utils::Rectangle;

    #[test]
    fn a_frame_in_points_misses_a_fractional_screen() {
        let screen = Rectangle::new((0, 0).into(), (1098, 686).into());
        assert_eq!(pixels(screen, 1.75), (0, 0, 1922, 1201));
        assert_eq!(pixels(screen, 2.0), (0, 0, 2196, 1372));
        // The nearest whole points to the screen's own pixels: a row over, never two columns.
        let nearest = points((0, 0, 1920, 1200), 1.75);
        assert_eq!(nearest.size, (1097, 686).into());
        assert_eq!(pixels(nearest, 1.75), (0, 0, 1920, 1201));
        assert_eq!(points((0, 0, 3840, 2400), 2.0).size, (1920, 1200).into());
    }

    #[test]
    fn a_size_asked_in_full_screen_is_the_frame_to_go_back_to() {
        let frame = Rectangle::new((40, 60).into(), (1098, 714).into());
        assert_eq!(after(frame, 28, Some(800), Some(600)), (800, 628).into());
        assert_eq!(after(frame, 28, None, Some(600)), (1098, 628).into());
        assert_eq!(after(frame, 0, None, None), (1098, 714).into());
    }
}
