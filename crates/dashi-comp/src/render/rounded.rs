//! Windows Dashi frames get rounded corners at the Appearance radius: under
//! Dashi's title bar the bottom ones (the bar rounds the top), on a unified
//! window all four. So does a window that draws its own frame while it is
//! maximized (the shell's Fill), all four: it drops its own corners then.
//! The corners are the window's, not a surface's: every surface of the window
//! that reaches a corner (Chromium draws its page and toolbar on subsurfaces)
//! is drawn through the shader with the window's box in its own pixels. The window's main surface is drawn through a texture
//! shader that fades the pixels outside each corner's arc (antialiased).
//! The GLES frame is reached through `GlesAccess`, for the nested renderer
//! and the multi-GPU one alike. A rounded surface is never scanned out
//! directly. It is opaque where its client says, but for the cut corners
//! (rounded/corners.rs): what shows through them must be drawn, and nothing
//! else behind the window is.

mod corners;

use smithay::{
    backend::renderer::{
        ImportAll, Renderer,
        element::{
            Element, Id, Kind, RenderElement, UnderlyingStorage,
            surface::WaylandSurfaceRenderElement,
        },
        gles::{
            GlesError, GlesFrame, GlesRenderer, GlesTexProgram, Uniform, UniformName, UniformType,
        },
        utils::{CommitCounter, DamageSet, OpaqueRegions},
    },
    utils::{Buffer, Physical, Point, Rectangle, Scale, Transform},
};

/// The fragment shader: smithay's texture shader, with the corners cut.
const SHADER: &str = r#"
#version 100
//_DEFINES_
#if defined(EXTERNAL)
#extension GL_OES_EGL_image_external : require
#endif
precision mediump float;
#if defined(EXTERNAL)
uniform samplerExternalOES tex;
#else
uniform sampler2D tex;
#endif
uniform float alpha;
varying vec2 v_coords;
#if defined(DEBUG_FLAGS)
uniform float tint;
#endif
// The surface's size, the window's box (x, y, width, height) from the surface's top-left,
// and the corner radius, in the frame's pixels.
uniform vec2 size;
uniform vec4 box;
// The part of the buffer drawn (x, y, width, height, as fractions of it): a client may show a
// crop of a bigger buffer (the viewporter, Chromium at a fractional scale), and the texture
// coordinates span the whole buffer, not the quad.
uniform vec4 crop;
uniform float radius;
// 1.0: the top corners are cut too (a unified window has no bar above it).
uniform float top;

void main() {
    vec4 color = texture2D(tex, v_coords);
#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0) * alpha;
#else
    color = color * alpha;
#endif
    vec2 p = (v_coords - crop.xy) / crop.zw * size - box.xy;
    vec2 s = box.zw;
    bool bottom = p.y > s.y - radius;
    bool upper = top > 0.5 && p.y < radius;
    if ((bottom || upper) && (p.x < radius || p.x > s.x - radius)) {
        vec2 center = vec2(p.x < radius ? radius : s.x - radius, bottom ? s.y - radius : radius);
        color *= clamp(radius - distance(p, center) + 0.5, 0.0, 1.0);
    }
#if defined(DEBUG_FLAGS)
    if (tint == 1.0)
        color = vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8;
#endif
    gl_FragColor = color;
}
"#;

/// The renderers Dashi draws with, opened up to their GLES parts.
pub(crate) trait GlesAccess: Renderer {
    fn gles(&mut self) -> &mut GlesRenderer;
    fn gles_frame<'a, 'frame, 'buffer>(
        frame: &'a mut Self::Frame<'frame, 'buffer>,
    ) -> &'a mut GlesFrame<'frame, 'buffer>;
    /// A GLES frame's error as this renderer's.
    fn gles_error(error: GlesError) -> Self::Error;
}

impl GlesAccess for GlesRenderer {
    fn gles(&mut self) -> &mut GlesRenderer {
        self
    }

    fn gles_frame<'a, 'frame, 'buffer>(
        frame: &'a mut Self::Frame<'frame, 'buffer>,
    ) -> &'a mut GlesFrame<'frame, 'buffer> {
        frame
    }

    fn gles_error(error: GlesError) -> Self::Error {
        error
    }
}

/// The shader, compiled once per GPU and kept with its EGL context.
struct Program(Option<GlesTexProgram>);

pub(crate) fn program(renderer: &mut GlesRenderer) -> Option<GlesTexProgram> {
    let data = renderer.egl_context().user_data();
    if let Some(Program(program)) = data.get::<Program>() {
        return program.clone();
    }
    let compiled = renderer
        .compile_custom_texture_shader(
            SHADER,
            &[
                UniformName::new("size", UniformType::_2f),
                UniformName::new("box", UniformType::_4f),
                UniformName::new("crop", UniformType::_4f),
                UniformName::new("radius", UniformType::_1f),
                UniformName::new("top", UniformType::_1f),
            ],
        )
        .inspect_err(|error| {
            tracing::warn!(?error, "no rounded corners: the shader did not compile")
        })
        .ok();
    renderer
        .egl_context()
        .user_data()
        .insert_if_missing(|| Program(compiled.clone()));
    compiled
}

/// A surface of a window that reaches one of the window's corners, drawn with them cut.
pub(crate) struct RoundedElement<R: Renderer> {
    inner: WaylandSurfaceRenderElement<R>,
    program: GlesTexProgram,
    /// The radius in physical pixels, where it is drawn.
    radius: f32,
    /// The top corners too (no Dashi title bar above it).
    top: bool,
    /// The window's box from this surface's top-left, as fractions of the surface's size
    /// (x, y, width, height): the same wherever the surface is drawn, shrunk or not.
    window: [f32; 4],
    /// The radius in physical pixels where the element is made (before any shrinking).
    reach: i32,
}

impl<R: Renderer> RoundedElement<R> {
    pub(crate) fn new(
        inner: WaylandSurfaceRenderElement<R>,
        program: GlesTexProgram,
        radius: f32,
        top: bool,
        window: [f32; 4],
        reach: i32,
    ) -> Self {
        Self {
            inner,
            program,
            radius,
            top,
            window,
            reach,
        }
    }
}

impl<R: Renderer + ImportAll> Element for RoundedElement<R> {
    fn id(&self) -> &Id {
        self.inner.id()
    }

    fn current_commit(&self) -> CommitCounter {
        self.inner.current_commit()
    }

    fn src(&self) -> Rectangle<f64, Buffer> {
        self.inner.src()
    }

    fn geometry(&self, scale: Scale<f64>) -> Rectangle<i32, Physical> {
        self.inner.geometry(scale)
    }

    fn location(&self, scale: Scale<f64>) -> Point<i32, Physical> {
        self.inner.location(scale)
    }

    fn transform(&self) -> Transform {
        self.inner.transform()
    }

    fn damage_since(
        &self,
        scale: Scale<f64>,
        commit: Option<CommitCounter>,
    ) -> DamageSet<i32, Physical> {
        self.inner.damage_since(scale, commit)
    }

    // The surface's own, less the cut corners: what shows through them must still be drawn.
    fn opaque_regions(&self, scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        let cut = corners::cut(
            self.inner.geometry(scale).size,
            self.window,
            self.reach,
            self.top,
        );
        OpaqueRegions::from_slice(&corners::opaque_but(self.inner.opaque_regions(scale), cut))
    }

    fn alpha(&self) -> f32 {
        self.inner.alpha()
    }

    fn kind(&self) -> Kind {
        self.inner.kind()
    }
}

impl<R> RenderElement<R> for RoundedElement<R>
where
    R: Renderer + ImportAll + GlesAccess,
    WaylandSurfaceRenderElement<R>: RenderElement<R>,
{
    fn draw(
        &self,
        frame: &mut R::Frame<'_, '_>,
        src: Rectangle<f64, Buffer>,
        dst: Rectangle<i32, Physical>,
        damage: &[Rectangle<i32, Physical>],
        opaque_regions: &[Rectangle<i32, Physical>],
    ) -> Result<(), R::Error> {
        let (w, h) = (dst.size.w as f32, dst.size.h as f32);
        let [x, y, bw, bh] = self.window;
        // The shown part of the buffer, both in the surface's logical size.
        let (view, buffer) = (self.inner.view().src, self.inner.buffer_size().to_f64());
        let crop = if buffer.w > 0.0 && buffer.h > 0.0 && view.size.w > 0.0 && view.size.h > 0.0 {
            (
                (view.loc.x / buffer.w) as f32,
                (view.loc.y / buffer.h) as f32,
                (view.size.w / buffer.w) as f32,
                (view.size.h / buffer.h) as f32,
            )
        } else {
            (0.0, 0.0, 1.0, 1.0)
        };
        let uniforms = vec![
            Uniform::new("size", (w, h)),
            Uniform::new("box", (x * w, y * h, bw * w, bh * h)),
            Uniform::new("crop", crop),
            Uniform::new("radius", self.radius),
            Uniform::new("top", if self.top { 1.0f32 } else { 0.0 }),
        ];
        R::gles_frame(frame).override_default_tex_program(self.program.clone(), uniforms);
        let drawn = self.inner.draw(frame, src, dst, damage, opaque_regions);
        R::gles_frame(frame).clear_tex_program_override();
        drawn
    }

    // Shaded, so never handed to a plane as it is.
    fn underlying_storage(&self, _renderer: &mut R) -> Option<UnderlyingStorage<'_>> {
        None
    }
}
