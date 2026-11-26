//! Where panes go among a screen's elements: the shell's (IPC `glass`, by
//! namespace) and a client surface's (surfaces.rs), each made a
//! GlassElement at the screen's pixels, behind the surface that wears it.
//!
//! A surface names its panes back to front, as it paints them (a later one
//! over an earlier one: the lock's Today over its veil); a screen's elements
//! go front to back, so they are given in the other order (`front_first`).
//! Each keeps its index in the surface's list (`PaneKey`): its first pane's
//! tone is still the first's.

use smithay::{
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Physical, Point, Rectangle, Scale, Size},
};

use super::{
    Glass,
    element::{Clip, GlassElement, Owner, PaneKey},
    style::Look,
    surfaces,
};

/// A surface's entrance: its alpha, and its scale about a point.
pub(crate) type Motion = Option<(f32, Point<i32, Physical>, f64)>;

/// A pane at `rect` (surface logical) of a surface drawn at `at`, at `scale`, in motion.
fn placed(
    rect: Rectangle<f64, Logical>,
    at: Point<i32, Physical>,
    scale: Scale<f64>,
    motion: Motion,
) -> (Rectangle<i32, Physical>, f64) {
    let mut geometry = rect.to_physical_precise_round(scale);
    geometry.loc += at;
    let Some((_, about, by)) = motion else {
        return (geometry, 1.0);
    };
    let from = (geometry.loc - about).to_f64().upscale(by);
    geometry.loc = about + from.to_i32_round();
    geometry.size = geometry.size.to_f64().upscale(by).to_i32_round();
    (geometry, by)
}

/// `look` at the screen's pixels, grown `by` (the blur is not: a blur that changed each frame
/// of an entrance would be drawn anew each).
fn at_scale(look: Look, scale: Scale<f64>, by: f64) -> Look {
    let scaled = look.scaled(scale.x);
    Look {
        radius: scaled.radius * by,
        ..scaled
    }
}

impl Glass {
    /// The shell's panes of a surface of `namespace` drawn at `at` (the screen's pixels), `size`
    /// big, at `scale`, in `motion`.
    pub(crate) fn elements(
        &self,
        namespace: &str,
        at: Point<i32, Physical>,
        size: Size<i32, Logical>,
        scale: Scale<f64>,
        motion: Motion,
    ) -> Vec<GlassElement> {
        let Some(panes) = self.panes.get(namespace) else {
            return Vec::new();
        };
        let alpha = motion.map_or(1.0, |(alpha, _, _)| alpha);
        let mode = self
            .style
            .as_ref()
            .map(|style| style.mode)
            .unwrap_or_default();
        let panes = panes
            .iter()
            .enumerate()
            .filter_map(|(index, pane)| {
                let rect = pane
                    .rect
                    .unwrap_or_else(|| Rectangle::from_size(size.to_f64()));
                let (look, twin) = match (pane.level, &self.style) {
                    (Some(level), Some(style)) => {
                        (style.look(level, pane.look.radius)?, style.twin(level))
                    }
                    (Some(_), None) => return None,
                    (None, _) => (pane.look.in_mode(mode)?, None),
                };
                let (geometry, by) = placed(rect, at, scale, motion);
                let key = PaneKey {
                    owner: Owner::Shell(namespace.to_owned()),
                    index,
                };
                let element = GlassElement::new(key, geometry, at_scale(look, scale, by), alpha);
                Some(element.clipped(None, twin))
            })
            .collect();
        front_first(panes)
    }

    /// The tile preview's pane (WI-10): `level` at `rect` (the screen's pixels), `radius` round
    /// in points, at `scale`; none without a style, or once this GPU could not frost.
    pub(crate) fn preview_element(
        &self,
        rect: Rectangle<i32, Physical>,
        level: super::Level,
        radius: f64,
        scale: Scale<f64>,
    ) -> Option<GlassElement> {
        let style = self.style.as_ref().filter(|_| self.can())?;
        let look = style.look(level, radius)?;
        let key = PaneKey {
            owner: Owner::TilePreview,
            index: 0,
        };
        Some(
            GlassElement::new(key, rect, at_scale(look, scale, 1.0), 1.0)
                .clipped(None, style.twin(level)),
        )
    }

    /// A client surface's panes, when its client has glass: the surface drawn at `at`, `size`
    /// big, at `scale`, in `motion`, cut to `clip` (its window's frame).
    pub(crate) fn surface_elements(
        &self,
        surface: &WlSurface,
        (at, size): (Point<i32, Physical>, Size<i32, Logical>),
        scale: Scale<f64>,
        motion: Motion,
        clip: Option<Clip>,
    ) -> Vec<GlassElement> {
        let Some(style) = self.style.as_ref().filter(|_| self.can()) else {
            return Vec::new();
        };
        let granted = surface
            .client()
            .is_some_and(|client| self.clients.granted(&client.id()));
        if !granted {
            return Vec::new();
        }
        let alpha = motion.map_or(1.0, |(alpha, _, _)| alpha);
        let panes = surfaces::committed(surface, size, style)
            .into_iter()
            .enumerate()
            .map(
                |(
                    index,
                    surfaces::Shown {
                        shape,
                        cut,
                        look,
                        level,
                    },
                )| {
                    let (geometry, by) = placed(shape.to_f64(), at, scale, motion);
                    let cut = cut.map(|cut| placed(cut.to_f64(), at, scale, motion).0);
                    let key = PaneKey {
                        owner: Owner::Surface(surface.id()),
                        index,
                    };
                    let twin = level.and_then(|level| style.twin(level));
                    GlassElement::new(key, geometry, at_scale(look, scale, by), alpha)
                        .clipped(clip, twin)
                        .cut_to(cut)
                },
            )
            .collect();
        front_first(panes)
    }
}

/// A surface's panes, named back to front, in a screen's order: front to back.
fn front_first<T>(mut panes: Vec<T>) -> Vec<T> {
    panes.reverse();
    panes
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_pane_painted_later_is_in_front() {
        // The lock names its veil, then Today on it, then a card on Today.
        let named = vec!["veil", "today", "card"];
        // The screen's elements go front to back: the card first, the veil behind everything.
        assert_eq!(super::front_first(named), vec!["card", "today", "veil"]);
    }
}
