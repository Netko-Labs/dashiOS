//! A thumbnail's piece of a surface or an image: scaled about a point, cut to
//! the thumbnail's rect, and under an id of its own. The same surface is
//! often on screen at full size too (a window in the switcher, the current
//! Desktop in its preview); with its own id, the damage tracker sees two
//! elements, not one that keeps jumping between places.

use smithay::{
    backend::renderer::{
        Renderer,
        element::{
            Element, Id, Kind, RenderElement, UnderlyingStorage,
            utils::{CropRenderElement, RescaleRenderElement},
        },
        utils::{CommitCounter, DamageSet, OpaqueRegions},
    },
    utils::{Buffer, Physical, Point, Rectangle, Scale, Transform},
};

pub(crate) struct Thumb<E> {
    inner: CropRenderElement<RescaleRenderElement<E>>,
    id: Id,
}

impl<E: Element> Thumb<E> {
    /// `element` shrunk by `by` about `about`, cut to `crop` (physical, as
    /// the element is placed); None when nothing of it is left inside.
    pub(crate) fn new(
        element: E,
        about: Point<i32, Physical>,
        by: f64,
        scale: Scale<f64>,
        crop: Rectangle<i32, Physical>,
        id: Id,
    ) -> Option<Self> {
        let scaled = RescaleRenderElement::from_element(element, about, by);
        let inner = CropRenderElement::from_element(scaled, scale, crop)?;
        Some(Self { inner, id })
    }
}

impl<E: Element> Element for Thumb<E> {
    fn id(&self) -> &Id {
        &self.id
    }

    fn current_commit(&self) -> CommitCounter {
        self.inner.current_commit()
    }

    fn src(&self) -> Rectangle<f64, Buffer> {
        self.inner.src()
    }

    fn transform(&self) -> Transform {
        self.inner.transform()
    }

    fn geometry(&self, scale: Scale<f64>) -> Rectangle<i32, Physical> {
        self.inner.geometry(scale)
    }

    fn damage_since(
        &self,
        scale: Scale<f64>,
        commit: Option<CommitCounter>,
    ) -> DamageSet<i32, Physical> {
        self.inner.damage_since(scale, commit)
    }

    fn opaque_regions(&self, scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        self.inner.opaque_regions(scale)
    }

    fn alpha(&self) -> f32 {
        self.inner.alpha()
    }

    fn kind(&self) -> Kind {
        Kind::Unspecified
    }
}

impl<R: Renderer, E: RenderElement<R>> RenderElement<R> for Thumb<E> {
    fn draw(
        &self,
        frame: &mut R::Frame<'_, '_>,
        src: Rectangle<f64, Buffer>,
        dst: Rectangle<i32, Physical>,
        damage: &[Rectangle<i32, Physical>],
        opaque_regions: &[Rectangle<i32, Physical>],
    ) -> Result<(), R::Error> {
        self.inner.draw(frame, src, dst, damage, opaque_regions)
    }

    /// Never scanned out on a plane of its own: a thumbnail is a small copy.
    fn underlying_storage(&self, _renderer: &mut R) -> Option<UnderlyingStorage<'_>> {
        None
    }
}
