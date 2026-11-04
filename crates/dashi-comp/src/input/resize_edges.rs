//! Resizing a window Dashi frames (its title bar, or a unified window) by its
//! edges: such a window draws no resize border of its own, so the compositor
//! keeps an invisible one around its frame. The pointer over it shows the
//! resize cursor for that edge or corner; a press there starts a resize grab.
//! Windows that draw their own frame (GTK's) ask to resize themselves.

use smithay::{
    desktop::Window,
    input::pointer::{CursorIcon, Focus, GrabStartData},
    utils::{Logical, Point, Rectangle, Serial},
};

use crate::{
    render::titlebar::Decor,
    state::Dashi,
    wm::{frame_of, grabs::ResizeEdge, grabs::ResizeSurfaceGrab},
};

/// How far outside the frame the border reaches, and how far inside (logical px).
const OUTSIDE: f64 = 6.0;
const INSIDE: f64 = 3.0;

/// The edges of `frame` that `pos` is on, if it is on its border.
fn edges_at(frame: Rectangle<f64, Logical>, pos: Point<f64, Logical>) -> Option<ResizeEdge> {
    let (left, top) = (frame.loc.x, frame.loc.y);
    let (right, bottom) = (left + frame.size.w, top + frame.size.h);
    if pos.x < left - OUTSIDE
        || pos.x > right + OUTSIDE
        || pos.y < top - OUTSIDE
        || pos.y > bottom + OUTSIDE
    {
        return None;
    }
    let mut edges = ResizeEdge::empty();
    if pos.x < left + INSIDE {
        edges |= ResizeEdge::LEFT;
    } else if pos.x > right - INSIDE {
        edges |= ResizeEdge::RIGHT;
    }
    if pos.y < top + INSIDE {
        edges |= ResizeEdge::TOP;
    } else if pos.y > bottom - INSIDE {
        edges |= ResizeEdge::BOTTOM;
    }
    (!edges.is_empty()).then_some(edges)
}

/// The cursor for resizing by `edges`.
pub(crate) fn cursor_for(edges: ResizeEdge) -> CursorIcon {
    match edges {
        e if e == ResizeEdge::TOP_LEFT => CursorIcon::NwResize,
        e if e == ResizeEdge::TOP_RIGHT => CursorIcon::NeResize,
        e if e == ResizeEdge::BOTTOM_LEFT => CursorIcon::SwResize,
        e if e == ResizeEdge::BOTTOM_RIGHT => CursorIcon::SeResize,
        e if e.contains(ResizeEdge::TOP) => CursorIcon::NResize,
        e if e.contains(ResizeEdge::BOTTOM) => CursorIcon::SResize,
        e if e.contains(ResizeEdge::LEFT) => CursorIcon::WResize,
        _ => CursorIcon::EResize,
    }
}

impl Dashi {
    /// The framed window whose resize border is at `pos`, and which edges.
    pub(crate) fn resize_edge_at(&self, pos: Point<f64, Logical>) -> Option<(Window, ResizeEdge)> {
        if self.lock.locked || self.overview_open() || self.top_layer_at(pos) {
            return None;
        }
        for window in self.space.elements().rev() {
            let Some(entry) = self.windows.by_window(window).filter(|e| e.announced) else {
                continue;
            };
            let Some(frame) = frame_of(self, window).map(|f| f.to_f64()) else {
                continue;
            };
            let framed = entry.decor != Decor::None && entry.fullscreen.is_none();
            if framed && let Some(edges) = edges_at(frame, pos) {
                return Some((window.clone(), edges));
            }
            // A window over the point hides the borders of those under it.
            if frame.contains(pos) {
                return None;
            }
        }
        None
    }

    /// The pointer moved (with no grab): the resize cursor over a border, else the client's.
    pub(crate) fn hover_resize_edges(&mut self, pos: Point<f64, Logical>) {
        let grabbed = self
            .seat
            .get_pointer()
            .is_some_and(|pointer| pointer.is_grabbed());
        if grabbed {
            return;
        }
        self.resize_cursor = self.resize_edge_at(pos).map(|(_, edges)| cursor_for(edges));
    }

    /// A press on a resize border: raise the window and resize it with the pointer.
    pub(crate) fn press_resize_edge(
        &mut self,
        pos: Point<f64, Logical>,
        button: u32,
        serial: Serial,
    ) -> bool {
        let Some((window, edges)) = self.resize_edge_at(pos) else {
            return false;
        };
        let (Some(pointer), Some(location)) = (
            self.seat.get_pointer(),
            self.space.element_location(&window),
        ) else {
            return false;
        };
        if let Some(id) = self.windows.by_window(&window).map(|e| e.id) {
            let _ = self.focus_window(id);
        }
        let start = GrabStartData {
            focus: None,
            button,
            location: pos,
        };
        let initial = Rectangle::new(location, window.geometry().size);
        let grab = ResizeSurfaceGrab::start(start, window, edges, initial);
        self.resize_cursor = Some(cursor_for(edges));
        pointer.set_grab(self, grab, serial, Focus::Clear);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Rectangle<f64, Logical> {
        Rectangle::new((100.0, 100.0).into(), (400.0, 300.0).into())
    }

    #[test]
    fn borders_and_corners_but_not_the_inside() {
        let at = |x: f64, y: f64| edges_at(frame(), (x, y).into());
        assert_eq!(at(97.0, 250.0), Some(ResizeEdge::LEFT));
        assert_eq!(at(503.0, 250.0), Some(ResizeEdge::RIGHT));
        assert_eq!(at(300.0, 98.0), Some(ResizeEdge::TOP));
        assert_eq!(at(300.0, 404.0), Some(ResizeEdge::BOTTOM));
        assert_eq!(at(96.0, 96.0), Some(ResizeEdge::TOP_LEFT));
        assert_eq!(at(504.0, 404.0), Some(ResizeEdge::BOTTOM_RIGHT));
        assert_eq!(at(300.0, 250.0), None, "inside is the window's");
        assert_eq!(at(80.0, 250.0), None, "too far out");
    }

    #[test]
    fn each_edge_has_its_cursor() {
        assert_eq!(cursor_for(ResizeEdge::TOP_LEFT), CursorIcon::NwResize);
        assert_eq!(cursor_for(ResizeEdge::BOTTOM), CursorIcon::SResize);
        assert_eq!(cursor_for(ResizeEdge::RIGHT), CursorIcon::EResize);
    }
}
