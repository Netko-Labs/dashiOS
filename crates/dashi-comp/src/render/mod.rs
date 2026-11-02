//! What the compositor draws, as render elements per output, and the images
//! it draws itself (title bars, cursors, text).

pub(crate) mod canvas;
pub(crate) mod cursor;
mod scene;
pub(crate) mod text;
pub(crate) mod titlebar;

use smithay::backend::renderer::{
    ImportAll, ImportMem,
    element::{memory::MemoryRenderBufferRenderElement, surface::WaylandSurfaceRenderElement},
};

pub(crate) use scene::output_elements;

smithay::backend::renderer::element::render_elements! {
    /// Everything on a screen: client surfaces, and images the compositor drew.
    pub(crate) DashiElement<R> where R: ImportAll + ImportMem;
    Surface=WaylandSurfaceRenderElement<R>,
    Memory=MemoryRenderBufferRenderElement<R>,
}
