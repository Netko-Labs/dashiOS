//! Where a window is drawn right now, by scene.rs's rules: in its frame, or
//! small in the overview, flying to the Dock, or sliding with its Space (a
//! window held in a move grab stays put). What must follow the picture
//! rather than the window's frame (capture masks, mask.rs) asks here.

use smithay::utils::{Logical, Point, Rectangle};

use crate::{
    state::Dashi,
    wm::{Shown, WindowId, frame_of},
};

impl Dashi {
    /// Window `id`'s outer frame (title bar included) as drawn now, and the
    /// scale it is drawn at; None while it isn't drawn.
    pub(crate) fn drawn_frame(&self, id: WindowId) -> Option<(Rectangle<f64, Logical>, f64)> {
        let entry = self.windows.get(id)?;
        let window = &entry.window;
        let width = f64::from(window.geometry().size.w.max(1));
        let small = |rect: Rectangle<f64, Logical>| (rect, rect.size.w / width);
        if let Some(flight) = self.motion.flights.get(&id) {
            return Some(small(flight.now().0));
        }
        if self.overview.is_some() {
            return self.overview_rect(id).map(small);
        }
        let slide = self.spaces.slide.filter(|_| self.held != Some(id));
        if let Some(mut frame) = frame_of(self, window) {
            if let Some(offset) = slide
                .and_then(|_| self.slide_offset(self.spaces.current, self.screen_width_at(frame)))
            {
                frame.loc += offset;
            }
            return Some((frame.to_f64(), 1.0));
        }
        // Off screen, but sliding in with its Space: drawn from where it waits.
        let slide = slide?;
        if entry.space != slide.to || entry.shown != Shown::Normal {
            return None;
        }
        let at = entry.away_at?;
        let bar = self.bar_height(window);
        let size = window.geometry().size;
        let mut frame = Rectangle::new(
            Point::from((at.x, at.y - bar)),
            (size.w, size.h + bar).into(),
        );
        frame.loc += self.slide_offset(slide.to, self.screen_width_at(frame))?;
        Some((frame.to_f64(), 1.0))
    }

    /// The width of the screen under the middle of `rect` (else the first screen's).
    fn screen_width_at(&self, rect: Rectangle<i32, Logical>) -> i32 {
        let middle = rect.loc.to_f64() + rect.size.to_f64().downscale(2.0).to_point();
        self.space
            .output_under(middle)
            .next()
            .or_else(|| self.space.outputs().next())
            .and_then(|output| self.space.output_geometry(output))
            .map_or(1, |geometry| geometry.size.w)
    }
}
