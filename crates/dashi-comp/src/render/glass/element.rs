//! One pane of glass in a screen's elements: put where its surface is drawn
//! (behind it), then frosted (frost.rs) once everything behind it is known.
//! Until then, or where nothing frosts (nested, a GPU whose shaders did not
//! compile), it is nothing: no size, no damage, and what is behind shows.
//! Drawn, it reaches its hairline's width past the pane (the hairline is
//! outside the edge) and is opaque inside it but for its corners. A pane cut
//! to what clips it on its surface (`cut`: a list scrolled past it) is drawn
//! only there, its shape still the whole pane's, cut straight.

use smithay::{
    backend::renderer::{
        Renderer, Texture,
        element::{Element, Id, Kind, RenderElement, UnderlyingStorage},
        gles::{GlesTexProgram, GlesTexture},
        utils::{CommitCounter, OpaqueRegions},
    },
    utils::{Buffer, Physical, Point, Rectangle, Scale, Size},
};

use super::{kawase::ORIENT, style::Look};
use crate::render::GlesAccess;

/// Whose pane: one of the shell's surfaces (IPC `glass`, by namespace), or a client's surface.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Owner {
    Shell(String),
    Surface(smithay::reexports::wayland_server::backend::ObjectId),
    /// Where a dragged window would tile (WI-10): no words on it, so its tone goes nowhere.
    TilePreview,
}

/// Which pane this is, from frame to frame: its owner and its place in the list.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct PaneKey {
    pub owner: Owner,
    pub index: usize,
}

/// What a pane is cut to besides its own corners: its window's frame, in the screen's pixels,
/// with the frame's radius at the top and at the bottom.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Clip {
    pub rect: Rectangle<i32, Physical>,
    pub radii: (f32, f32),
}

/// What frosting gave the pane: the blurred picture and the part of it under the pane.
#[derive(Clone)]
pub(super) struct Frosted {
    pub id: Id,
    pub commit: CommitCounter,
    pub texture: GlesTexture,
    pub src: Rectangle<f64, Buffer>,
    pub program: GlesTexProgram,
}

pub(crate) struct GlassElement {
    pub(super) key: PaneKey,
    /// Where it is on the screen, in the screen's pixels: the whole pane, its corners its own.
    pub(super) geometry: Rectangle<i32, Physical>,
    /// What of it shows (none: all of it), in the screen's pixels.
    pub(super) cut: Option<Rectangle<i32, Physical>>,
    /// Its look, with the radius and blur in the screen's pixels.
    pub(super) look: Look,
    pub(super) alpha: f32,
    pub(super) clip: Option<Clip>,
    /// Its level's solid twin, for when it is too deep under other glass (GL-2).
    pub(super) twin: Option<[f32; 3]>,
    pub(super) frosted: Option<Frosted>,
    /// Shown where no frost is: an id of its own, never damaged.
    idle: Id,
}

impl GlassElement {
    pub(super) fn new(
        key: PaneKey,
        geometry: Rectangle<i32, Physical>,
        look: Look,
        alpha: f32,
    ) -> Self {
        Self {
            key,
            geometry,
            look,
            alpha,
            cut: None,
            clip: None,
            twin: None,
            frosted: None,
            idle: Id::new(),
        }
    }

    pub(crate) fn clipped(self, clip: Option<Clip>, twin: Option<[f32; 3]>) -> Self {
        Self { clip, twin, ..self }
    }

    /// Shown only inside `cut` (the screen's pixels), its shape kept.
    pub(crate) fn cut_to(self, cut: Option<Rectangle<i32, Physical>>) -> Self {
        Self { cut, ..self }
    }

    /// What of the pane shows: all of it, or what its cut keeps.
    pub(super) fn visible(&self) -> Rectangle<i32, Physical> {
        self.cut
            .and_then(|cut| cut.intersection(self.geometry))
            .unwrap_or(self.geometry)
    }

    /// How far it reaches past the pane: its hairline, in whole pixels.
    pub(super) fn keel(&self) -> i32 {
        if self.look.keel.1[3] <= 0.0 {
            return 0;
        }
        self.look.keel.0.ceil().clamp(0.0, 8.0) as i32
    }

    /// What is drawn: the pane and its hairline, but for what its cut leaves out (the hairline
    /// only along the edges the cut keeps).
    pub(super) fn outer(&self) -> Rectangle<i32, Physical> {
        outer(self.geometry, self.cut, self.keel())
    }

    fn shown(&self) -> Rectangle<i32, Physical> {
        match self.frosted {
            Some(_) => self.outer(),
            None => Rectangle::new(self.geometry.loc, Size::default()),
        }
    }
}

impl Element for GlassElement {
    fn id(&self) -> &Id {
        self.frosted.as_ref().map_or(&self.idle, |f| &f.id)
    }

    fn current_commit(&self) -> CommitCounter {
        self.frosted
            .as_ref()
            .map_or_else(CommitCounter::default, |f| f.commit)
    }

    fn src(&self) -> Rectangle<f64, Buffer> {
        self.frosted
            .as_ref()
            .map_or_else(Rectangle::default, |f| f.src)
    }

    fn geometry(&self, _scale: Scale<f64>) -> Rectangle<i32, Physical> {
        self.shown()
    }

    fn location(&self, _scale: Scale<f64>) -> Point<i32, Physical> {
        self.shown().loc
    }

    // Opaque but for its rounded corners and hairline (and while it fades in), within its clip.
    fn opaque_regions(&self, _scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        if self.frosted.is_none() || self.alpha < 1.0 {
            return OpaqueRegions::default();
        }
        OpaqueRegions::from_slice(&opaque(
            self.outer(),
            self.geometry,
            self.look.radius,
            self.clip,
        ))
    }

    fn alpha(&self) -> f32 {
        self.alpha
    }

    fn kind(&self) -> Kind {
        Kind::Unspecified
    }
}

/// What a pane at `pane` draws, its hairline `keel` pixels wide, shown inside `cut`: the pane and
/// its hairline, the hairline only along the edges the cut keeps (an edge it crosses is cut
/// straight). Empty when the cut keeps nothing.
pub(super) fn outer(
    pane: Rectangle<i32, Physical>,
    cut: Option<Rectangle<i32, Physical>>,
    keel: i32,
) -> Rectangle<i32, Physical> {
    let (left, top) = (pane.loc.x, pane.loc.y);
    let (right, bottom) = (left + pane.size.w, top + pane.size.h);
    let Some(cut) = cut else {
        return Rectangle::new(
            pane.loc - Point::from((keel, keel)),
            pane.size + Size::from((2 * keel, 2 * keel)),
        );
    };
    let (cut_right, cut_bottom) = (cut.loc.x + cut.size.w, cut.loc.y + cut.size.h);
    let from = |kept: bool, edge: i32, at: i32| if kept { edge } else { at };
    let x0 = from(cut.loc.x <= left, left - keel, cut.loc.x.max(left));
    let y0 = from(cut.loc.y <= top, top - keel, cut.loc.y.max(top));
    let x1 = from(cut_right >= right, right + keel, cut_right.min(right));
    let y1 = from(cut_bottom >= bottom, bottom + keel, cut_bottom.min(bottom));
    Rectangle::new((x0, y0).into(), ((x1 - x0).max(0), (y1 - y0).max(0)).into())
}

/// The opaque part of a pane at `pane` drawn in `outer` (relative to `outer`): its solid bands,
/// within what is drawn, cut to what its clip keeps whole. Never an empty rectangle.
pub(super) fn opaque(
    outer: Rectangle<i32, Physical>,
    pane: Rectangle<i32, Physical>,
    radius: f64,
    clip: Option<Clip>,
) -> Vec<Rectangle<i32, Physical>> {
    let drawn = Rectangle::from_size(outer.size);
    let bands = solid(pane.size, radius)
        .into_iter()
        .map(move |band| Rectangle::new(band.loc + (pane.loc - outer.loc), band.size))
        .filter_map(move |band| band.intersection(drawn))
        .filter(|band| !band.is_empty());
    let Some(clip) = clip else {
        return bands.collect();
    };
    // What the clip keeps whole, relative to `outer`: its rect less its corners' reach.
    let reach = clip.radii.0.max(clip.radii.1).ceil() as i32;
    let kept = Rectangle::new(
        clip.rect.loc - outer.loc + Point::from((0, reach)),
        clip.rect.size - Size::from((0, 2 * reach)),
    );
    bands
        .filter_map(|band| band.intersection(kept))
        .filter(|band| !band.is_empty())
        .collect()
}

/// A pane's solid part: all but its rounded corners, as up to three bands. Never an empty
/// one (a radius of 0): an empty rectangle reaches the display as an empty damage clip, and it
/// refuses the frame (EINVAL), again and again.
fn solid(size: Size<i32, Physical>, radius: f64) -> Vec<Rectangle<i32, Physical>> {
    let r = (radius.ceil() as i32).clamp(0, size.w.min(size.h) / 2);
    let band = |x: i32, y: i32, w: i32, h: i32| Rectangle::new((x, y).into(), (w, h).into());
    [
        band(0, r, size.w, size.h - 2 * r),
        band(r, 0, size.w - 2 * r, r),
        band(r, size.h - r, size.w - 2 * r, r),
    ]
    .into_iter()
    .filter(|band| !band.is_empty())
    .collect()
}

impl<R: Renderer + GlesAccess> RenderElement<R> for GlassElement {
    fn draw(
        &self,
        frame: &mut R::Frame<'_, '_>,
        _src: Rectangle<f64, Buffer>,
        dst: Rectangle<i32, Physical>,
        damage: &[Rectangle<i32, Physical>],
        opaque_regions: &[Rectangle<i32, Physical>],
    ) -> Result<(), R::Error> {
        let Some(frosted) = &self.frosted else {
            return Ok(());
        };
        let size = frosted.texture.size().to_f64();
        let src = frosted.src;
        let crop = (
            (src.loc.x / size.w) as f32,
            (src.loc.y / size.h) as f32,
            (src.size.w / size.w) as f32,
            (src.size.h / size.h) as f32,
        );
        let uniforms = super::shaders::uniforms(self, dst, crop);
        R::gles_frame(frame)
            .render_texture_from_to(
                &frosted.texture,
                src,
                dst,
                damage,
                opaque_regions,
                ORIENT,
                self.alpha,
                Some(&frosted.program),
                &uniforms,
            )
            .map_err(R::gles_error)
    }

    fn underlying_storage(&self, _renderer: &mut R) -> Option<UnderlyingStorage<'_>> {
        None
    }
}

#[cfg(test)]
#[path = "element_tests.rs"]
mod tests;
