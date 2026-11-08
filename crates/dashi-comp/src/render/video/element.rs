//! A video view's picture: the latest frame, drawn through a texture shader
//! that rounds the view's corners and cuts its holes (where the app's own
//! controls over the picture show through: the shutter, the last shots),
//! each a rounded rect, antialiased. Holes and corners are kept in logical
//! pixels of the view and scaled to wherever it is drawn.

use smithay::{
    backend::renderer::{
        ImportMem, Renderer,
        element::{
            Element, Id, Kind, RenderElement, UnderlyingStorage,
            memory::MemoryRenderBufferRenderElement,
        },
        gles::{GlesRenderer, GlesTexProgram, Uniform, UniformName, UniformType},
        utils::{CommitCounter, DamageSet, OpaqueRegions},
    },
    utils::{Buffer, Physical, Point, Rectangle, Scale, Transform},
};

use super::{HOLES, Hole};
use crate::render::GlesAccess;

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
// The view's size in the frame's pixels; the part of the buffer shown (x, y, w, h as fractions);
// 1.0 when the picture is mirrored; the corner radii (top-left, top-right, bottom-right, bottom-left).
uniform vec2 size;
uniform vec4 crop;
uniform float mirror;
uniform vec4 corners;
// The holes: rects (x, y, w, h) in the frame's pixels from the view's top-left, their radii four
// to a vec4, and how many there are.
uniform vec4 h0;
uniform vec4 h1;
uniform vec4 h2;
uniform vec4 h3;
uniform vec4 h4;
uniform vec4 h5;
uniform vec4 h6;
uniform vec4 h7;
uniform vec4 r0;
uniform vec4 r1;
uniform float count;

// Signed distance from p to a rounded rect: negative inside.
float box(vec2 p, vec4 r, float radius) {
    vec2 half_size = r.zw * 0.5;
    vec2 q = abs(p - (r.xy + half_size)) - half_size + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float cut(vec2 p, vec4 r, float radius, float index) {
    if (index >= count) return 1.0;
    return clamp(box(p, r, radius) + 0.5, 0.0, 1.0);
}

void main() {
    vec4 color = texture2D(tex, v_coords);
#if defined(NO_ALPHA)
    color = vec4(color.rgb, 1.0) * alpha;
#else
    color = color * alpha;
#endif
    vec2 u = (v_coords - crop.xy) / crop.zw;
    if (mirror > 0.5) u.x = 1.0 - u.x;
    vec2 p = u * size;
    float left = p.x < size.x * 0.5 ? 1.0 : 0.0;
    float upper = p.y < size.y * 0.5 ? 1.0 : 0.0;
    float radius = upper > 0.5 ? (left > 0.5 ? corners.x : corners.y) : (left > 0.5 ? corners.w : corners.z);
    color *= clamp(0.5 - box(p, vec4(0.0, 0.0, size), radius), 0.0, 1.0);
    color *= cut(p, h0, r0.x, 0.0);
    color *= cut(p, h1, r0.y, 1.0);
    color *= cut(p, h2, r0.z, 2.0);
    color *= cut(p, h3, r0.w, 3.0);
    color *= cut(p, h4, r1.x, 4.0);
    color *= cut(p, h5, r1.y, 5.0);
    color *= cut(p, h6, r1.z, 6.0);
    color *= cut(p, h7, r1.w, 7.0);
#if defined(DEBUG_FLAGS)
    if (tint == 1.0)
        color = vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8;
#endif
    gl_FragColor = color;
}
"#;

struct Program(Option<GlesTexProgram>);

/// The shader, compiled once per GPU and kept with its EGL context.
pub(crate) fn program(renderer: &mut GlesRenderer) -> Option<GlesTexProgram> {
    let data = renderer.egl_context().user_data();
    if let Some(Program(program)) = data.get::<Program>() {
        return program.clone();
    }
    let mut names = vec![
        UniformName::new("size", UniformType::_2f),
        UniformName::new("crop", UniformType::_4f),
        UniformName::new("mirror", UniformType::_1f),
        UniformName::new("corners", UniformType::_4f),
        UniformName::new("r0", UniformType::_4f),
        UniformName::new("r1", UniformType::_4f),
        UniformName::new("count", UniformType::_1f),
    ];
    names.extend(
        HOLE_NAMES
            .iter()
            .map(|name| UniformName::new(*name, UniformType::_4f)),
    );
    let compiled = renderer
        .compile_custom_texture_shader(SHADER, &names)
        .inspect_err(|error| tracing::warn!(?error, "no video views: the shader did not compile"))
        .ok();
    renderer
        .egl_context()
        .user_data()
        .insert_if_missing(|| Program(compiled.clone()));
    compiled
}

const HOLE_NAMES: [&str; HOLES] = ["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7"];

/// The picture of one view where it is drawn.
pub(crate) struct VideoElement<R: Renderer> {
    pub inner: MemoryRenderBufferRenderElement<R>,
    pub program: GlesTexProgram,
    /// The view's logical width (holes and radii are logical; the frame's pixels are not).
    pub width: f64,
    pub corners: [f32; 4],
    pub holes: Vec<Hole>,
    pub mirror: bool,
    /// The part of the buffer shown, as fractions of it.
    pub crop: [f32; 4],
}

impl<R: Renderer> Element for VideoElement<R>
where
    MemoryRenderBufferRenderElement<R>: Element,
{
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

    // The holes and corners show what is under it.
    fn opaque_regions(&self, _scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        OpaqueRegions::default()
    }

    fn alpha(&self) -> f32 {
        self.inner.alpha()
    }

    fn kind(&self) -> Kind {
        Kind::Unspecified
    }
}

impl<R> RenderElement<R> for VideoElement<R>
where
    R: Renderer + ImportMem + GlesAccess,
    MemoryRenderBufferRenderElement<R>: RenderElement<R>,
{
    fn draw(
        &self,
        frame: &mut R::Frame<'_, '_>,
        src: Rectangle<f64, Buffer>,
        dst: Rectangle<i32, Physical>,
        damage: &[Rectangle<i32, Physical>],
        opaque_regions: &[Rectangle<i32, Physical>],
    ) -> Result<(), R::Error> {
        let k = (f64::from(dst.size.w) / self.width.max(1.0)) as f32;
        let mut uniforms = vec![
            Uniform::new("size", (dst.size.w as f32, dst.size.h as f32)),
            Uniform::new(
                "crop",
                (self.crop[0], self.crop[1], self.crop[2], self.crop[3]),
            ),
            Uniform::new("mirror", if self.mirror { 1.0f32 } else { 0.0 }),
            Uniform::new(
                "corners",
                (
                    self.corners[0] * k,
                    self.corners[1] * k,
                    self.corners[2] * k,
                    self.corners[3] * k,
                ),
            ),
            Uniform::new("count", self.holes.len() as f32),
        ];
        let mut radii = [0.0f32; HOLES];
        for (index, name) in HOLE_NAMES.iter().enumerate() {
            let hole = self.holes.get(index);
            let rect = hole.map_or((0.0, 0.0, 0.0, 0.0), |hole| {
                (hole.x * k, hole.y * k, hole.w * k, hole.h * k)
            });
            radii[index] = hole.map_or(0.0, |hole| hole.radius * k);
            uniforms.push(Uniform::new(*name, rect));
        }
        uniforms.push(Uniform::new("r0", (radii[0], radii[1], radii[2], radii[3])));
        uniforms.push(Uniform::new("r1", (radii[4], radii[5], radii[6], radii[7])));
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
