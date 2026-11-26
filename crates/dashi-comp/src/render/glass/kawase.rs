//! The blur's passes over one pane's backdrop (shaders.rs has the filter):
//! down `passes` times from the backdrop (already drawn at half size), then
//! up again into a picture the backdrop's size.

use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            Offscreen, Texture,
            gles::{GlesError, GlesRenderer, GlesTexture, ffi},
        },
    },
    utils::{Buffer, Size, Transform},
};

use super::{
    gl::{self, Step},
    shaders::Programs,
};

/// How a texture the renderer drew is sampled the right way up: as it is (smithay's
/// projection and its texture coordinates agree; glass/gpu_tests.rs checks it).
pub(super) const ORIENT: Transform = Transform::Normal;

/// The fewest and most halvings after the half-size backdrop.
const PASSES: (usize, usize) = (1, 6);

/// The halvings and the taps' spread for a blur of `sigma` physical pixels (about CSS's
/// `blur()`): each halving doubles the reach, the spread (1 to 2.5 texels) fills in between.
pub(super) fn plan(sigma: f64) -> (usize, f32) {
    if sigma <= 0.0 {
        return (0, 0.0);
    }
    // The backdrop is drawn at half size: a texel there is two pixels.
    let wanted = (sigma / 2.0).max(1.0);
    let passes = (wanted.log2().ceil() as usize).clamp(PASSES.0, PASSES.1);
    let spread = (wanted / (1u64 << passes) as f64 * 2.0).clamp(1.0, 2.5) as f32;
    (passes, spread)
}

/// How far the blur reaches past a pane, in physical pixels: what the backdrop draws beyond it.
pub(super) fn reach(sigma: f64) -> i32 {
    let (passes, spread) = plan(sigma);
    if passes == 0 {
        return 0;
    }
    // Two pixels a backdrop texel, doubled each halving, the spread's taps, both ways.
    (2.0 * f64::from(spread) * (1u64 << passes) as f64 * 1.5).ceil() as i32
}

/// The textures one pane's blur needs: the halvings, and the picture it ends in, each with
/// a framebuffer (gl.rs).
pub(super) struct Pyramid {
    levels: Vec<GlesTexture>,
    pub out: GlesTexture,
    /// The levels' framebuffers, then the picture's.
    framebuffers: Vec<ffi::types::GLuint>,
}

impl Pyramid {
    /// For a backdrop of `size` texels, halved `passes` times.
    pub(super) fn new(
        gles: &mut GlesRenderer,
        size: Size<i32, Buffer>,
        passes: usize,
    ) -> Result<Self, GlesError> {
        let mut levels = Vec::with_capacity(passes);
        let mut at = size;
        for _ in 0..passes {
            at = ((at.w + 1) / 2, (at.h + 1) / 2).into();
            levels.push(gles.create_buffer(Fourcc::Abgr8888, at)?);
        }
        let out = gles.create_buffer(Fourcc::Abgr8888, size)?;
        let mut framebuffers = Vec::with_capacity(passes + 1);
        for texture in levels.iter().chain(std::iter::once(&out)) {
            framebuffers.push(gl::framebuffer(gles, texture)?);
        }
        Ok(Self {
            levels,
            out,
            framebuffers,
        })
    }

    pub(super) fn passes(&self) -> usize {
        self.levels.len()
    }

    /// The mean colour of the blur's smallest picture (tone.rs), read back from the GPU.
    pub(super) fn mean(&self, gles: &mut GlesRenderer) -> Option<[f32; 3]> {
        let (texture, framebuffer) = match self.levels.last() {
            Some(last) => (last, self.framebuffers[self.levels.len() - 1]),
            None => (&self.out, self.framebuffers[0]),
        };
        gl::mean(gles, framebuffer, (texture.size().w, texture.size().h))
    }

    /// Let its framebuffers go (its textures go with it).
    pub(super) fn free(self, gles: &mut GlesRenderer) {
        gl::forget(gles, &self.framebuffers);
    }

    /// Blur `backdrop` into `out`.
    pub(super) fn blur(
        &mut self,
        gles: &mut GlesRenderer,
        programs: &Programs,
        backdrop: &GlesTexture,
        spread: f32,
    ) -> Result<(), GlesError> {
        let size = |texture: &GlesTexture| (texture.size().w, texture.size().h);
        let count = self.levels.len();
        let out = Step {
            from: self.levels.first().unwrap_or(backdrop).tex_id(),
            into: self.framebuffers[count],
            into_size: size(&self.out),
            down: false,
            spread: if count == 0 { 0.0 } else { spread },
        };
        let mut steps = Vec::with_capacity(2 * count + 1);
        for at in 0..count {
            let from = if at == 0 {
                backdrop
            } else {
                &self.levels[at - 1]
            };
            steps.push(Step {
                from: from.tex_id(),
                into: self.framebuffers[at],
                into_size: size(&self.levels[at]),
                down: true,
                spread,
            });
        }
        for at in (1..count).rev() {
            steps.push(Step {
                from: self.levels[at].tex_id(),
                into: self.framebuffers[at - 1],
                into_size: size(&self.levels[at - 1]),
                down: false,
                spread,
            });
        }
        steps.push(out);
        programs.passes.run(gles, &steps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thicker_glass_halves_more() {
        assert_eq!(plan(0.0), (0, 0.0));
        let (thin, _) = plan(8.0);
        let (thick, _) = plan(60.0);
        assert!(thin >= 1 && thick > thin);
        assert!(plan(10_000.0).0 <= PASSES.1);
        let (_, spread) = plan(40.0);
        assert!((1.0..=2.5).contains(&spread));
    }

    #[test]
    fn the_backdrop_reaches_past_the_blur() {
        assert_eq!(reach(0.0), 0);
        assert!(reach(30.0) > 30);
        assert!(reach(60.0) > reach(30.0));
    }
}
