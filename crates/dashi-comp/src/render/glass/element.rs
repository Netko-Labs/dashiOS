//! One pane of glass in a screen's elements: put where its surface is drawn
//! (behind it), then frosted (frost.rs) once everything behind it is known.
//! Until then, or where nothing frosts (nested, a GPU whose shaders did not
//! compile), it is nothing: no size, no damage, and what is behind shows.

use smithay::{
    backend::renderer::{
        Renderer, Texture,
        element::{Element, Id, Kind, RenderElement, UnderlyingStorage},
        gles::{GlesTexProgram, GlesTexture, Uniform},
        utils::{CommitCounter, OpaqueRegions},
    },
    utils::{Buffer, Physical, Point, Rectangle, Scale, Size},
};

use super::{kawase::ORIENT, params::Look};
use crate::render::GlesAccess;

/// Which pane this is, from frame to frame: its surface's namespace and its place in the list.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct PaneKey {
    pub namespace: String,
    pub index: usize,
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
            frosted: None,
            idle: Id::new(),
        }
    }

    fn shown(&self) -> Rectangle<i32, Physical> {
        match self.frosted {
            Some(_) => self.geometry,
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
        self.geometry.loc
    }

    // Opaque but for its rounded corners (and while it fades in).
    fn opaque_regions(&self, _scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        if self.frosted.is_none() || self.alpha < 1.0 {
            return OpaqueRegions::default();
        }
        OpaqueRegions::from_slice(&solid(self.geometry.size, self.look.radius))
    }

    fn alpha(&self) -> f32 {
        self.alpha
    }

    fn kind(&self) -> Kind {
        Kind::Unspecified
    }
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
        let look = self.look;
        let uniforms = [
            Uniform::new("size", (dst.size.w as f32, dst.size.h as f32)),
            Uniform::new("crop", crop),
            Uniform::new("radius", look.radius as f32),
            Uniform::new("saturation", look.saturation),
            Uniform::new("brightness", look.brightness),
            Uniform::new("floor_ink", look.floor),
            Uniform::new("glass_tint", look.tint),
            Uniform::new("noise", look.noise),
        ];
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
}
