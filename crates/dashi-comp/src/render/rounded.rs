//! Windows with Dashi's title bar get rounded bottom corners, matching the
//! bar's top ones: the window's main surface is drawn through a texture
//! shader that fades the pixels outside each corner's arc (antialiased).
//! The GLES frame is reached through `GlesAccess`, for the nested renderer
//! and the multi-GPU one alike. A rounded surface is never scanned out
//! directly and claims no opaque region (what shows through its corners must
//! be drawn).

use smithay::{
    backend::renderer::{
        ImportAll, Renderer,
        element::{
            Element, Id, Kind, RenderElement, UnderlyingStorage,
            surface::WaylandSurfaceRenderElement,
        },
        gles::{GlesFrame, GlesRenderer, GlesTexProgram, Uniform, UniformName, UniformType},
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
// The surface's size and the corner radius, in the frame's pixels.
uniform vec2 size;
uniform float radius;

void main() {
    vec4 color = texture2D(tex, v_coords);
#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0) * alpha;
#else
    color = color * alpha;
#endif
    vec2 p = v_coords * size;
    if (p.y > size.y - radius && (p.x < radius || p.x > size.x - radius)) {
        vec2 center = vec2(p.x < radius ? radius : size.x - radius, size.y - radius);
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
                UniformName::new("radius", UniformType::_1f),
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

/// A window's main surface, drawn with rounded bottom corners.
pub(crate) struct RoundedElement<R: Renderer> {
    inner: WaylandSurfaceRenderElement<R>,
    program: GlesTexProgram,
    /// The radius in physical pixels.
    radius: f32,
}

impl<R: Renderer> RoundedElement<R> {
    pub(crate) fn new(
        inner: WaylandSurfaceRenderElement<R>,
        program: GlesTexProgram,
        radius: f32,
    ) -> Self {
        Self {
            inner,
            program,
            radius,
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

    // What shows through the corners must still be drawn.
    fn opaque_regions(&self, _scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        OpaqueRegions::default()
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
        let uniforms = vec![
            Uniform::new("size", (dst.size.w as f32, dst.size.h as f32)),
            Uniform::new("radius", self.radius),
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
