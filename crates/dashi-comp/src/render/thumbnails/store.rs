//! The shell's pictures as the compositor holds them: Desktop pictures per
//! screen, window pictures, and the steady element ids that track damage.

use std::collections::HashMap;

use smithay::{
    backend::renderer::element::Id,
    utils::{Logical, Rectangle},
};

use crate::wm::WindowId;

/// More pictures than any panel of the shell's shows.
pub(super) const MOST: usize = 64;
/// Element ids kept before the map starts over (surfaces come and go while a panel is up).
const MOST_IDS: usize = 4096;

/// A picture's rect, global logical.
pub(super) type Rect = Rectangle<i32, Logical>;

/// A Desktop's picture: which Space, where, and which screen of it (by name).
#[derive(Clone)]
pub(super) struct Preview {
    pub space: usize,
    pub rect: Rect,
    pub screen: String,
}

#[derive(Default)]
pub(crate) struct Thumbnails {
    /// Per screen name, the Desktop pictures drawn on it.
    pub(super) previews: HashMap<String, Vec<Preview>>,
    /// Window pictures: (window, rect).
    pub(super) windows: Vec<(WindowId, Rect)>,
    /// A steady id per (picture, element shown in it), so damage is tracked per picture.
    pub(super) ids: HashMap<(usize, Id), Id>,
}

impl Thumbnails {
    pub(crate) fn is_empty(&self) -> bool {
        self.previews.is_empty() && self.windows.is_empty()
    }

    /// The id for element `source` in picture `slot`, the same every frame.
    pub(super) fn id(&mut self, slot: usize, source: &Id) -> Id {
        if self.ids.len() > MOST_IDS {
            self.ids.clear();
        }
        self.ids
            .entry((slot, source.clone()))
            .or_insert_with(Id::new)
            .clone()
    }

    /// The windows in window pictures (they hear frame callbacks even off screen).
    pub(crate) fn window_ids(&self) -> impl Iterator<Item = WindowId> + '_ {
        self.windows.iter().map(|(id, _)| *id)
    }

    /// Every picture that shows `window` (on Space `space`): its window
    /// pictures and the Desktop pictures of its Space, for a capture mask
    /// to blank whole (render/mask.rs).
    pub(crate) fn showing(&self, window: WindowId, space: usize) -> Vec<Rect> {
        let windows = self
            .windows
            .iter()
            .filter(|(id, _)| *id == window)
            .map(|(_, rect)| *rect);
        let desktops = self
            .previews
            .values()
            .flatten()
            .filter(|preview| preview.space == space)
            .map(|preview| preview.rect);
        windows.chain(desktops).collect()
    }

    /// The Spaces with a picture on any screen.
    pub(crate) fn previewed_spaces(&self) -> impl Iterator<Item = usize> + '_ {
        self.previews
            .values()
            .flatten()
            .map(|preview| preview.space)
    }
}
