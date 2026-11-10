//! The wallpaper as it is shown: its pixels, how they fit the screen, and
//! the element drawn behind everything.

use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            ImportMem, Renderer,
            element::{
                Kind,
                memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
            },
        },
    },
    reexports::calloop::RegistrationToken,
    utils::{Logical, Physical, Point, Rectangle, Scale, Size, Transform},
};

use super::{
    fit::{self, Mode},
    procedural::{self, Look},
    video,
};

pub(crate) struct Wallpaper {
    pub(super) shown: Shown,
    pub(super) mode: Mode,
    pub(super) paused: bool,
    /// Bumped by each request: a picture or video that finishes loading for an older one is dropped.
    pub(super) generation: u64,
    /// Event sources of the content being shown (a video's channels, a live look's timer).
    pub(super) sources: Vec<RegistrationToken>,
    pub(super) player: Option<video::Player>,
}

/// The pixels on screen and how big the source is.
pub(super) struct Shown {
    pub(super) buffer: MemoryRenderBuffer,
    pub(super) size: (i32, i32),
    /// Live looks always fill; pictures and videos follow the mode.
    pub(super) follows_mode: bool,
}

impl Default for Wallpaper {
    fn default() -> Self {
        Self {
            shown: procedural_shown(Look::Gradient, 0.0),
            mode: Mode::Fill,
            paused: false,
            generation: 0,
            sources: Vec::new(),
            player: None,
        }
    }
}

pub(super) fn procedural_shown(look: Look, t: f32) -> Shown {
    let mut pixels = vec![0u8; procedural::WIDTH * procedural::HEIGHT * 4];
    procedural::draw(look, t, &mut pixels);
    let size = (procedural::WIDTH as i32, procedural::HEIGHT as i32);
    Shown {
        buffer: MemoryRenderBuffer::from_slice(
            &pixels,
            Fourcc::Abgr8888,
            size,
            1,
            Transform::Normal,
            None,
        ),
        size,
        follows_mode: false,
    }
}

impl Wallpaper {
    /// The wallpaper's element for a screen at `origin` (physical, in the view) of logical `size`.
    pub(crate) fn element<R>(
        &self,
        renderer: &mut R,
        origin: Point<i32, Logical>,
        size: Size<i32, Logical>,
        scale: Scale<f64>,
    ) -> Option<MemoryRenderBufferRenderElement<R>>
    where
        R: Renderer + ImportMem,
        R::TextureId: Clone + Send + 'static,
    {
        let mode = if self.shown.follows_mode {
            self.mode
        } else {
            Mode::Fill
        };
        let (w, h) = self.shown.size;
        let (src, dst) = fit::place(
            mode,
            (f64::from(w), f64::from(h)),
            (f64::from(size.w), f64::from(size.h)),
            scale.x,
        );
        if dst.2 < 1.0 || dst.3 < 1.0 {
            return None;
        }
        let at: Point<f64, Physical> =
            (origin.to_f64() + Point::from((dst.0, dst.1))).to_physical(scale);
        let source = Rectangle::new(Point::from((src.0, src.1)), Size::from((src.2, src.3)));
        let dest = Size::from((dst.2.round() as i32, dst.3.round() as i32));
        MemoryRenderBufferRenderElement::from_buffer(
            renderer,
            at,
            &self.shown.buffer,
            None,
            Some(source),
            Some(dest),
            Kind::Unspecified,
        )
        .inspect_err(|error| tracing::warn!(?error, "drawing the wallpaper"))
        .ok()
    }
}

/// A video frame into the shown buffer: drawn in place when the size is the same.
pub(super) fn show_frame(shown: &mut Shown, frame: video::Frame) {
    if !shown.follows_mode || shown.size != (frame.width, frame.height) {
        let buffer = MemoryRenderBuffer::from_slice(
            &frame.rgba,
            Fourcc::Abgr8888,
            (frame.width, frame.height),
            1,
            Transform::Normal,
            None,
        );
        *shown = Shown {
            buffer,
            size: (frame.width, frame.height),
            follows_mode: true,
        };
        return;
    }
    let size = (frame.width, frame.height);
    let _ = shown.buffer.render().draw(|pixels| {
        let n = pixels.len().min(frame.rgba.len());
        pixels[..n].copy_from_slice(&frame.rgba[..n]);
        Ok::<_, ()>(vec![Rectangle::from_size(size.into())])
    });
}
