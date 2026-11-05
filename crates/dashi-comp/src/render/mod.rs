//! What the compositor draws, as render elements per output, and the images
//! it draws itself (title bars, cursors, text).

pub(crate) mod canvas;
pub(crate) mod capture;
pub(crate) mod cursor;
// Agents (0.4.0, secrets): what their pictures blank.
pub(crate) mod mask;
pub(crate) mod present;
pub(crate) mod rounded;
mod scene;
pub(crate) mod text;
pub(crate) mod thumbnails;
pub(crate) mod titlebar;

use smithay::backend::renderer::{
    ImportAll, ImportMem,
    element::{
        memory::MemoryRenderBufferRenderElement, solid::SolidColorRenderElement,
        surface::WaylandSurfaceRenderElement, utils::RescaleRenderElement,
    },
};

pub(crate) use rounded::GlesAccess;
pub(crate) use scene::{View, output_elements};

smithay::backend::renderer::element::render_elements! {
    /// Everything on a screen: client surfaces, and images the compositor drew.
    pub(crate) DashiElement<R> where R: ImportAll + ImportMem + GlesAccess;
    Surface=WaylandSurfaceRenderElement<R>,
    /// A window's main surface with rounded bottom corners (under a title bar).
    Rounded=rounded::RoundedElement<R>,
    Memory=MemoryRenderBufferRenderElement<R>,
    /// A window drawn small (the overview, a flight to the Dock).
    Scaled=RescaleRenderElement<WaylandSurfaceRenderElement<R>>,
    /// A plain shape (where a dragged window would tile).
    Solid=SolidColorRenderElement,
    /// A piece of a live picture the shell placed (thumbnails/): a window's surface,
    ThumbSurface=thumbnails::Thumb<WaylandSurfaceRenderElement<R>>,
    /// or a title bar or wallpaper in it.
    ThumbMemory=thumbnails::Thumb<MemoryRenderBufferRenderElement<R>>,
}
