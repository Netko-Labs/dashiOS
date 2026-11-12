//! The GLES renderer each graphics card draws with: smithay's, less its fence
//! after every textured draw.
//!
//! With `Capability::Fencing`, smithay's `GlesFrame` waits for a texture's
//! last fence and makes a new one after each quad it draws from it
//! (`TextureSync::update_read`). A fence flushes the GL context (Mesa flushes
//! for real once the context holds a dmabuf's image, as a compositor's always
//! does), so a frame cost one flush to the kernel per surface, title bar,
//! shadow's neighbour and wallpaper piece drawn: about a seventh of
//! dashi-comp's time while a window scrolled (dashi-0.8.0-review/03-bugs/cpu).
//! The fences order reads and writes of one texture between EGL contexts that
//! share it. Dashi's contexts share nothing: one per card, each used only on
//! the event loop, where GL runs in the order it is called. A frame's own
//! fence for the display (`Capability::ExportFence`) stays.

use smithay::backend::{
    drm::DrmDeviceFd,
    egl::{EGLContext, context::ContextPriority},
    renderer::{
        gles::{Capability, GlesRenderer},
        multigpu::gbm::{Error, GbmGlesBackend},
    },
};

/// The renderers' maker for the cards Dashi opens.
pub(super) fn backend() -> GbmGlesBackend<GlesRenderer, DrmDeviceFd> {
    GbmGlesBackend::with_factory(|display| {
        let context = EGLContext::new_with_priority(display, ContextPriority::default())
            .map_err(Error::Egl)?;
        // SAFETY: the context was made just above, on the event loop's thread, the only
        // one that ever makes it current.
        let supported =
            unsafe { GlesRenderer::supported_capabilities(&context) }.map_err(Error::Gl)?;
        // SAFETY: as above; and every capability asked for is one the context has.
        unsafe { GlesRenderer::with_capabilities(context, wanted(supported)) }.map_err(Error::Gl)
    })
}

/// What Dashi's renderer uses of what the card can do: all but the per-texture fences.
fn wanted(supported: Vec<Capability>) -> Vec<Capability> {
    supported
        .into_iter()
        .filter(|capability| *capability != Capability::Fencing)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_renderer_makes_no_fence_per_texture_and_keeps_the_frames_own() {
        let all = vec![
            Capability::Instancing,
            Capability::Blit,
            Capability::_10Bit,
            Capability::Renderbuffer,
            Capability::Fencing,
            Capability::ExportFence,
            Capability::Debug,
        ];
        let wanted = wanted(all.clone());
        assert!(!wanted.contains(&Capability::Fencing));
        assert_eq!(wanted.len(), all.len() - 1);
        assert!(wanted.contains(&Capability::ExportFence));
        assert_eq!(super::wanted(vec![Capability::Blit]), [Capability::Blit]);
    }
}
