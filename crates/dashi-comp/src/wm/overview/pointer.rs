//! The pointer and keys in the overview: where each window is drawn, what a
//! press, a drag and a release mean, and the keys the shell hears.

use smithay::utils::{Logical, Point, Rectangle};

use super::{DRAG_START, Overview, Press, lerp};
use crate::{ipc::protocol::Event, state::Dashi, wm::windows::WindowId};

impl Dashi {
    /// Where `id` is drawn now: between its frame and its place, or under the pointer while dragged.
    pub(crate) fn overview_rect(&self, id: WindowId) -> Option<Rectangle<f64, Logical>> {
        let overview = self.overview.as_ref()?;
        let (from, to) = (*overview.from.get(&id)?, *overview.targets.get(&id)?);
        let mut rect = lerp(from, to, overview.progress);
        if let Some(press) = overview
            .press
            .as_ref()
            .filter(|p| p.dragging && p.window == Some(id))
            && let Some(pointer) = self.seat.get_pointer()
        {
            rect.loc += pointer.current_location() - press.at;
        }
        Some(rect)
    }

    /// The window the overview shows at `at`, front first.
    fn overview_window_at(&self, at: Point<f64, Logical>) -> Option<WindowId> {
        let overview = self.overview.as_ref()?;
        self.space
            .elements()
            .rev()
            .filter_map(|window| self.windows.by_window(window).map(|e| e.id))
            .find(|id| {
                overview.targets.contains_key(id)
                    && self.overview_rect(*id).is_some_and(|r| r.contains(at))
            })
    }

    /// A press while the overview is open.
    pub(crate) fn overview_press(&mut self, at: Point<f64, Logical>) {
        let window = self.overview_window_at(at);
        if let Some(overview) = self.overview.as_mut() {
            overview.press = Some(Press {
                window,
                at,
                dragging: false,
            });
        }
    }

    /// The pointer moved while the overview is open: past a few pixels, a
    /// press on a window drags it, and the shell hears so once (`overview-drag`).
    pub(crate) fn overview_motion(&mut self, at: Point<f64, Logical>) {
        let Some(press) = self.overview.as_mut().and_then(|o| o.press.as_mut()) else {
            return;
        };
        let Some(window) = press.window.filter(|_| !press.dragging) else {
            return;
        };
        let moved = ((at.x - press.at.x).powi(2) + (at.y - press.at.y).powi(2)).sqrt();
        press.dragging = moved > DRAG_START;
        if press.dragging {
            self.ipc
                .emit(Event::overview_drag(window, at.x, at.y, false));
        }
    }

    /// A press in the overview is held: its release is the overview's, wherever it is (over the shell's row too).
    pub(crate) fn overview_pressed(&self) -> bool {
        self.overview.as_ref().is_some_and(|o| o.press.is_some())
    }

    /// The window being dragged in the overview, if one is: drawn in front
    /// of everything but the pointer, over the shell's row and its pictures
    /// (render/scene.rs), so the person sees what they carry onto a Desktop.
    pub(crate) fn overview_dragged(&self) -> Option<WindowId> {
        self.overview.as_ref().and_then(Overview::dragged)
    }

    /// The release: a pick (a window or the background), or a drop.
    pub(crate) fn overview_release(&mut self, at: Point<f64, Logical>) {
        let Some(press) = self.overview.as_mut().and_then(|o| o.press.take()) else {
            return;
        };
        match (press.window, press.dragging) {
            (Some(window), true) => self
                .ipc
                .emit(Event::overview_drag(window, at.x, at.y, true)),
            (window, false) => self.ipc.emit(Event::OverviewPick { window }),
            (None, true) => {}
        }
    }

    /// Whether the keyboard is on a layer surface (the shell's, given it by a press there).
    pub(crate) fn keyboard_on_layer(&self) -> bool {
        let Some(focus) = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
        else {
            return false;
        };
        self.space.outputs().any(|output| {
            smithay::desktop::layer_map_for_output(output)
                .layer_for_surface(&focus, smithay::desktop::WindowSurfaceType::TOPLEVEL)
                .is_some()
        })
    }

    /// A key while the overview is open, unless the keymap bound it.
    pub(crate) fn overview_key(&mut self, key: &str) {
        self.ipc.emit(Event::OverviewKey {
            key: key.to_owned(),
        });
    }
}
