//! A client surface's glass, as its last commit left it: the blur region of
//! ext-background-effect-v1 and the panes of dashi_glass_v1 (dashi-chrome-v1
//! v2), both double-buffered with the surface (smithay's cached state), so
//! glass changes in the same commit as the buffer drawn on it.
//!
//! Where a surface has panes they are its glass and its region is not read;
//! a region alone (an app that isn't Dashi's) is glass in each of its
//! rectangles, square, with the apps' look (style.rs `app_look`).

use smithay::{
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    utils::{Logical, Rectangle},
    wayland::compositor::{Cacheable, RectangleKind, RegionAttributes, with_states},
};

use super::style::{Level, Look, Style};

/// The most panes a surface may name in one commit (dashi-chrome-v1).
pub(crate) const MOST_PANES: usize = 16;
/// The most rectangles of a blur region made into panes; a region with more is its bounds.
const MOST_RECTS: usize = 16;
/// The largest radius a pane may ask (dashi-chrome-v1 `invalid_pane`).
pub(crate) const MOST_RADIUS: u32 = 512;

/// One pane a client named: surface-local logical, its radius and level, and what of it shows
/// (`cut_pane`, version 3: what clips it on the surface; none, all of it).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ClientPane {
    pub rect: Rectangle<i32, Logical>,
    pub radius: u32,
    pub level: Level,
    pub cut: Option<Rectangle<i32, Logical>>,
}

/// A pane to draw: its whole shape (its corners are its own), what of it shows on the surface
/// (none: all of it), its look (the radius held to half the shape's shorter side) and level.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Shown {
    pub shape: Rectangle<i32, Logical>,
    pub cut: Option<Rectangle<i32, Logical>>,
    pub look: Look,
    pub level: Option<Level>,
}

/// A surface's glass state. Pending: `None` is "unchanged since the last commit".
#[derive(Debug, Clone, Default)]
pub(crate) struct SurfaceGlass {
    /// The blur region's rectangles (only those added; a subtraction cuts the bounds).
    pub region: Option<Vec<Rectangle<i32, Logical>>>,
    pub panes: Option<Vec<ClientPane>>,
}

impl Cacheable for SurfaceGlass {
    fn commit(&mut self, _dh: &DisplayHandle) -> Self {
        // The next add_pane after a commit starts a new list; a region is copied when set.
        Self {
            region: self.region.take(),
            panes: self.panes.take(),
        }
    }

    fn merge_into(self, into: &mut Self, _dh: &DisplayHandle) {
        if self.region.is_some() {
            into.region = self.region;
        }
        if self.panes.is_some() {
            into.panes = self.panes;
        }
    }
}

/// A blur region as rectangles: its added ones, unless it subtracts or has too many, when it
/// is their bounds (an approximation the protocol allows: "subject to compositor policies").
pub(crate) fn region_rects(region: Option<&RegionAttributes>) -> Vec<Rectangle<i32, Logical>> {
    let Some(region) = region else {
        return Vec::new();
    };
    let added: Vec<_> = region
        .rects
        .iter()
        .filter(|(kind, rect)| matches!(kind, RectangleKind::Add) && !rect.is_empty())
        .map(|(_, rect)| *rect)
        .collect();
    let subtracts = region
        .rects
        .iter()
        .any(|(kind, _)| matches!(kind, RectangleKind::Subtract));
    if !subtracts && added.len() <= MOST_RECTS {
        return added;
    }
    let bounds = added.into_iter().reduce(|a, b| a.merge(b));
    bounds.into_iter().collect()
}

/// Change the pending state of `surface`'s glass.
pub(crate) fn pending(surface: &WlSurface, change: impl FnOnce(&mut SurfaceGlass)) {
    with_states(surface, |states| {
        change(states.cached_state.get::<SurfaceGlass>().pending());
    });
}

/// `surface`'s panes as its last commit left them, each with its look (logical, radius held
/// to half the shorter side), cut to `size`. Empty when the style draws none.
pub(crate) fn committed(
    surface: &WlSurface,
    size: smithay::utils::Size<i32, Logical>,
    style: &Style,
) -> Vec<Shown> {
    let current = with_states(surface, |states| {
        states.cached_state.get::<SurfaceGlass>().current().clone()
    });
    looks(&current, size, style)
}

/// The panes of `glass` within a surface of `size`, with their looks: each its whole shape, cut
/// to what of it shows on the surface (and to its own cut, `cut_pane`).
pub(crate) fn looks(
    glass: &SurfaceGlass,
    size: smithay::utils::Size<i32, Logical>,
    style: &Style,
) -> Vec<Shown> {
    let bounds = Rectangle::from_size(size);
    let clip = |rect: Rectangle<i32, Logical>| rect.intersection(bounds).filter(|r| !r.is_empty());
    match glass.panes.as_deref() {
        Some(panes) if !panes.is_empty() => panes
            .iter()
            .filter_map(|pane| {
                let within = match pane.cut {
                    Some(cut) => cut.intersection(pane.rect)?,
                    None => pane.rect,
                };
                let shows = clip(within)?;
                let most = f64::from(pane.rect.size.w.min(pane.rect.size.h)) / 2.0;
                let radius = f64::from(pane.radius).min(most);
                Some(Shown {
                    shape: pane.rect,
                    cut: (shows != pane.rect).then_some(shows),
                    look: style.look(pane.level, radius)?,
                    level: Some(pane.level),
                })
            })
            .collect(),
        _ => {
            let Some(look) = style.app_look() else {
                return Vec::new();
            };
            glass
                .region
                .iter()
                .flatten()
                .filter_map(|rect| {
                    Some(Shown {
                        shape: clip(*rect)?,
                        cut: None,
                        look,
                        level: None,
                    })
                })
                .collect()
        }
    }
}

#[cfg(test)]
#[path = "surfaces_tests.rs"]
mod tests;
