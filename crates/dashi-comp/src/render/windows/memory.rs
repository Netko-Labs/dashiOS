//! Putting an image the compositor drew itself (a title bar) among the elements.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            Kind,
            memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
        },
    },
    utils::{Logical, Physical, Point, Rectangle, Size},
};

use crate::render::{DashiElement, rounded::GlesAccess};

pub(crate) fn push_memory<R>(
    renderer: &mut R,
    at: Point<f64, Physical>,
    buffer: &MemoryRenderBuffer,
    // Drawn at another size: (its own, the one to draw it at).
    fit: Option<(Size<f64, Logical>, Size<i32, Logical>)>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    match MemoryRenderBufferRenderElement::from_buffer(
        renderer,
        at,
        buffer,
        None,
        fit.map(|(own, _)| Rectangle::from_size(own)),
        fit.map(|(_, size)| size),
        Kind::Unspecified,
    ) {
        Ok(element) => elements.push(DashiElement::Memory(element)),
        Err(error) => tracing::warn!(?error, "drawing the compositor's own image"),
    }
}
