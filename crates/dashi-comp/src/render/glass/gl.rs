//! The blur's passes in plain GL, all in one go: a framebuffer per level,
//! one quad each, nothing flushed or fenced between them. Through smithay's
//! frames each pass cost a frame's set-up, an EGL fence and a flush: about
//! 1.5 ms of the event loop per pane in the VM, the GPU idle meanwhile
//! (glass/gpu_tests.rs `blur_passes_cost`).
//!
//! Every GL call is here, made while smithay's context is current
//! (`with_context`), leaving the state smithay sets again on each frame:
//! its framebuffer, program, viewport, blending and vertex arrays.

use smithay::backend::renderer::gles::{GlesError, GlesRenderer, GlesTexture, ffi};

/// The quad's corners, as texture coordinates and, doubled less one, clip space.
const QUAD: [f32; 8] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];

const VERTEX: &str = "#version 100
attribute vec2 pos;
varying vec2 v_coords;
void main() {
    v_coords = pos;
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
";

const HEAD: &str = "#version 100
precision mediump float;
uniform sampler2D tex;
uniform vec2 half_px;
varying vec2 v_coords;
";

/// One linked program and where its inputs are.
#[derive(Clone, Copy)]
struct Program {
    id: ffi::types::GLuint,
    tex: ffi::types::GLint,
    half: ffi::types::GLint,
}

/// The two programs and the quad of one GPU.
#[derive(Clone, Copy)]
pub(super) struct Passes {
    down: Program,
    up: Program,
    quad: ffi::types::GLuint,
}

/// One pass: draw all of the texture `from` (`from_size` texels) into the framebuffer `into`
/// (`into_size`), halving (`down`) or doubling, its taps `spread` texels apart.
pub(super) struct Step {
    pub from: ffi::types::GLuint,
    pub into: ffi::types::GLuint,
    pub into_size: (i32, i32),
    pub down: bool,
    pub spread: f32,
}

struct Kept(Option<Passes>);

/// This GPU's passes, made the first time; none if they do not compile.
pub(super) fn passes(gles: &mut GlesRenderer, down: &str, up: &str) -> Option<Passes> {
    if let Some(Kept(kept)) = gles.egl_context().user_data().get::<Kept>() {
        return *kept;
    }
    let made = gles
        .with_context(|gl| {
            let down = link(gl, down)?;
            let up = link(gl, up)?;
            let mut quad = 0;
            // SAFETY: the context is current; one buffer, made and filled from a static array.
            unsafe {
                gl.GenBuffers(1, &mut quad);
                gl.BindBuffer(ffi::ARRAY_BUFFER, quad);
                gl.BufferData(
                    ffi::ARRAY_BUFFER,
                    std::mem::size_of_val(&QUAD) as isize,
                    QUAD.as_ptr().cast(),
                    ffi::STATIC_DRAW,
                );
                gl.BindBuffer(ffi::ARRAY_BUFFER, 0);
            }
            Some(Passes { down, up, quad })
        })
        .ok()
        .flatten();
    if made.is_none() {
        tracing::warn!("no glass: the blur's passes did not compile");
    }
    gles.egl_context()
        .user_data()
        .insert_if_missing(|| Kept(made));
    made
}

fn link(gl: &ffi::Gles2, body: &str) -> Option<Program> {
    let vertex = shader(gl, ffi::VERTEX_SHADER, VERTEX)?;
    let fragment = shader(gl, ffi::FRAGMENT_SHADER, &format!("{HEAD}{body}"))?;
    // SAFETY: the context is current; the shaders are ours and compiled; the names are NUL-ended.
    unsafe {
        let id = gl.CreateProgram();
        gl.AttachShader(id, vertex);
        gl.AttachShader(id, fragment);
        gl.BindAttribLocation(id, 0, c"pos".as_ptr());
        gl.LinkProgram(id);
        gl.DeleteShader(vertex);
        gl.DeleteShader(fragment);
        let mut linked = 0;
        gl.GetProgramiv(id, ffi::LINK_STATUS, &mut linked);
        if linked == 0 {
            gl.DeleteProgram(id);
            return None;
        }
        Some(Program {
            id,
            tex: gl.GetUniformLocation(id, c"tex".as_ptr()),
            half: gl.GetUniformLocation(id, c"half_px".as_ptr()),
        })
    }
}

fn shader(gl: &ffi::Gles2, kind: ffi::types::GLenum, source: &str) -> Option<ffi::types::GLuint> {
    let text = std::ffi::CString::new(source).ok()?;
    // SAFETY: the context is current; the source is NUL-ended and outlives the call.
    unsafe {
        let id = gl.CreateShader(kind);
        gl.ShaderSource(id, 1, &text.as_ptr(), std::ptr::null());
        gl.CompileShader(id);
        let mut compiled = 0;
        gl.GetShaderiv(id, ffi::COMPILE_STATUS, &mut compiled);
        if compiled == 0 {
            gl.DeleteShader(id);
            return None;
        }
        Some(id)
    }
}

/// A framebuffer drawing into `texture`.
pub(super) fn framebuffer(
    gles: &mut GlesRenderer,
    texture: &GlesTexture,
) -> Result<ffi::types::GLuint, GlesError> {
    let id = texture.tex_id();
    gles.with_context(|gl| {
        let mut fbo = 0;
        // SAFETY: the context is current; the texture is alive (held by the caller) and ours.
        unsafe {
            gl.GenFramebuffers(1, &mut fbo);
            gl.BindFramebuffer(ffi::FRAMEBUFFER, fbo);
            gl.FramebufferTexture2D(
                ffi::FRAMEBUFFER,
                ffi::COLOR_ATTACHMENT0,
                ffi::TEXTURE_2D,
                id,
                0,
            );
            gl.BindFramebuffer(ffi::FRAMEBUFFER, 0);
        }
        fbo
    })
}

/// Let `framebuffers` go.
pub(super) fn forget(gles: &mut GlesRenderer, framebuffers: &[ffi::types::GLuint]) {
    let _ = gles.with_context(|gl| {
        // SAFETY: the context is current; the framebuffers are ours, made by `framebuffer`.
        unsafe { gl.DeleteFramebuffers(framebuffers.len() as i32, framebuffers.as_ptr()) };
    });
}

impl Passes {
    /// Run `steps` in order.
    pub(super) fn run(&self, gles: &mut GlesRenderer, steps: &[Step]) -> Result<(), GlesError> {
        gles.with_context(|gl| {
            // SAFETY: the context is current; every name used is ours (programs, quad,
            // framebuffers) or a live texture of ours; the state touched is put back below.
            unsafe {
                gl.Disable(ffi::BLEND);
                gl.Disable(ffi::SCISSOR_TEST);
                gl.ActiveTexture(ffi::TEXTURE0);
                gl.BindBuffer(ffi::ARRAY_BUFFER, self.quad);
                gl.EnableVertexAttribArray(0);
                gl.VertexAttribPointer(0, 2, ffi::FLOAT, ffi::FALSE, 0, std::ptr::null());
                for step in steps {
                    let program = if step.down { self.down } else { self.up };
                    let (w, h) = step.into_size;
                    gl.BindFramebuffer(ffi::FRAMEBUFFER, step.into);
                    gl.Viewport(0, 0, w, h);
                    gl.UseProgram(program.id);
                    gl.BindTexture(ffi::TEXTURE_2D, step.from);
                    gl.TexParameteri(ffi::TEXTURE_2D, ffi::TEXTURE_MIN_FILTER, ffi::LINEAR as i32);
                    gl.TexParameteri(ffi::TEXTURE_2D, ffi::TEXTURE_MAG_FILTER, ffi::LINEAR as i32);
                    gl.Uniform1i(program.tex, 0);
                    gl.Uniform2f(
                        program.half,
                        0.5 / w.max(1) as f32 * step.spread,
                        0.5 / h.max(1) as f32 * step.spread,
                    );
                    gl.DrawArrays(ffi::TRIANGLE_STRIP, 0, 4);
                }
                gl.BindTexture(ffi::TEXTURE_2D, 0);
                gl.DisableVertexAttribArray(0);
                gl.BindBuffer(ffi::ARRAY_BUFFER, 0);
                gl.UseProgram(0);
                gl.BindFramebuffer(ffi::FRAMEBUFFER, 0);
            }
        })
    }
}
