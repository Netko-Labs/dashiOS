//! One pane of glass in a screen's elements: put where its surface is drawn
//! (behind it), then frosted (frost.rs) once everything behind it is known.
//! Until then, or where nothing frosts (nested, a GPU whose shaders did not
//! compile), it is nothing: no size, no damage, and what is behind shows.
//! Drawn, it reaches its hairline's width past the pane (the hairline is
//! outside the edge) and is opaque inside it but for its corners.

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
    /// Where it is on the screen, in the screen's pixels.
    pub(super) geometry: Rectangle<i32, Physical>,
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
            clip: None,
            twin: None,
            frosted: None,
            idle: Id::new(),
        }
    }

    pub(crate) fn clipped(self, clip: Option<Clip>, twin: Option<[f32; 3]>) -> Self {
        Self { clip, twin, ..self }
    }

    /// How far it reaches past the pane: its hairline, in whole pixels.
    pub(super) fn keel(&self) -> i32 {
        if self.look.keel.1[3] <= 0.0 {
            return 0;
        }
        self.look.keel.0.ceil().clamp(0.0, 8.0) as i32
    }

    /// The pane and its hairline.
    pub(super) fn outer(&self) -> Rectangle<i32, Physical> {
        let k = self.keel();
        Rectangle::new(
            self.geometry.loc - Point::from((k, k)),
            self.geometry.size + Size::from((2 * k, 2 * k)),
        )
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
            self.keel(),
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

/// The opaque part of a pane drawn in `outer` (relative to it): its solid bands inside the
/// hairline (`keel` pixels), cut to what its clip keeps whole. Never an empty rectangle.
pub(super) fn opaque(
    outer: Rectangle<i32, Physical>,
    keel: i32,
    radius: f64,
    clip: Option<Clip>,
) -> Vec<Rectangle<i32, Physical>> {
    let inner = outer.size - Size::from((2 * keel, 2 * keel));
    let bands = solid(inner, radius)
        .into_iter()
        .map(|band| Rectangle::new(band.loc + Point::from((keel, keel)), band.size));
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
mod tests {
    use super::*;

    #[test]
    fn a_pane_is_solid_but_its_corners_and_never_empty() {
        let square = solid((100, 40).into(), 0.0);
        assert_eq!(
            square,
            vec![Rectangle::new((0, 0).into(), (100, 40).into())]
        );
        let round = solid((100, 40).into(), 10.0);
        assert_eq!(round.len(), 3);
        assert!(round.iter().all(|band| !band.is_empty()));
        let area: i32 = round.iter().map(|band| band.size.w * band.size.h).sum();
        assert_eq!(area, 100 * 20 + 2 * 80 * 10);
        // A radius past half the height is held to it.
        assert!(
            solid((100, 40).into(), 90.0)
                .iter()
                .all(|band| !band.is_empty())
        );
    }

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    #[test]
    fn the_hairline_is_outside_and_never_opaque() {
        // A 100 × 40 pane with a 1 px hairline is drawn 102 × 42; its opaque part is the pane's.
        let bands = opaque(rect(9, 9, 102, 42), 1, 0.0, None);
        assert_eq!(bands, vec![rect(1, 1, 100, 40)]);
        let round = opaque(rect(9, 9, 102, 42), 1, 10.0, None);
        assert!(round.iter().all(|band| !band.is_empty()));
        assert!(round.iter().all(|band| band.loc.x >= 1 && band.loc.y >= 1));
    }

    #[test]
    fn a_clipped_pane_is_opaque_only_where_its_window_keeps_it_whole() {
        // A sidebar 200 × 600 in a window whose bottom corners are cut 12 round.
        let clip = Clip {
            rect: rect(0, 0, 800, 600),
            radii: (0.0, 12.0),
        };
        let outer = rect(-1, -1, 202, 602);
        let bands = opaque(outer, 1, 0.0, Some(clip));
        assert!(!bands.is_empty() && bands.iter().all(|band| !band.is_empty()));
        // Nothing opaque reaches the window's cut corners (12 rows at the top and bottom).
        for band in &bands {
            let top = band.loc.y + outer.loc.y;
            assert!(top >= 12 && top + band.size.h <= 600 - 12, "{band:?}");
        }
        // A clip that leaves nothing whole leaves nothing opaque, and no empty band.
        let thin = Clip {
            rect: rect(0, 0, 800, 20),
            radii: (12.0, 12.0),
        };
        assert!(opaque(rect(-1, -1, 202, 22), 1, 0.0, Some(thin)).is_empty());
    }
}
