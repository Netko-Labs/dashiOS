//! The depth drawn around a window, by one closed-form shader: no blur pass,
//! no offscreen buffer. Behind the window (`Back`): its shadow, up to two
//! layers of a Gaussian-blurred rounded rectangle (the blur's integral across
//! an edge, erf, taken on the shape's distance field), and the ring just
//! outside its frame; both cut out where the window is, so a rounded corner
//! shows the wallpaper and not the shadow. In front of the window, under
//! its popups (`Front`): the hairline just inside its frame. Each draws only
//! its bands (the frame's inside is a hole that is never shaded), and
//! damages only them when its look changes.

use smithay::{
    backend::renderer::{
        Renderer,
        element::{Element, Id, Kind, RenderElement, UnderlyingStorage},
        gles::{GlesPixelProgram, GlesRenderer, Uniform, UniformName, UniformType},
        utils::{CommitCounter, DamageSet, OpaqueRegions},
    },
    utils::{Buffer, Physical, Rectangle, Scale, Size},
};

use super::{geometry, style::Line};
use crate::render::rounded::GlesAccess;

const SHADER: &str = r#"
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 size;
uniform float alpha;
varying vec2 v_coords;
#if defined(DEBUG_FLAGS)
uniform float tint;
#endif
// The window's frame in the element's pixels (x, y, width, height), its corner radius.
uniform vec4 frame;
uniform float radius;
// Two shadow layers: offset x, y, sigma, spread; and their alphas.
uniform vec4 shade0;
uniform vec4 shade1;
uniform vec2 strength;
// Premultiplied colors and widths: the ring outside the frame, the edge inside it.
uniform vec4 ring_color;
uniform float ring_width;
uniform vec4 edge_color;
uniform float edge_width;
// 1.0: the edge (in front of the window); 0.0: the shadow and ring (behind it).
uniform float front;

float rounded_box(vec2 p, vec2 center, vec2 half_size, float r) {
    r = clamp(r, 0.0, min(half_size.x, half_size.y));
    vec2 q = abs(p - center) - half_size + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float erf_approx(float x) {
    float s = sign(x);
    float a = abs(x);
    float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    t *= t;
    return s - s / (t * t);
}

float layer_alpha(vec2 p, vec4 shade, vec2 center, vec2 half_size) {
    vec2 h = max(half_size + shade.w, vec2(0.0));
    float d = rounded_box(p, center + shade.xy, h, max(radius + shade.w, 0.0));
    if (shade.z < 0.5) return clamp(0.5 - d, 0.0, 1.0);
    return 0.5 - 0.5 * erf_approx(d / (shade.z * 1.4142136));
}

void main() {
    vec2 p = v_coords * size;
    vec2 half_size = frame.zw * 0.5;
    vec2 center = frame.xy + half_size;
    float d = rounded_box(p, center, half_size, radius);
    float inside = clamp(0.5 - d, 0.0, 1.0);
    vec4 color;
    if (front > 0.5) {
        float inner = clamp(0.5 - (d + edge_width), 0.0, 1.0);
        color = edge_color * max(inside - inner, 0.0);
    } else {
        float a0 = strength.x * layer_alpha(p, shade0, center, half_size);
        float a1 = strength.y * layer_alpha(p, shade1, center, half_size);
        color = vec4(0.0, 0.0, 0.0, a0 + a1 * (1.0 - a0));
        float ring = clamp(ring_width - d + 0.5, 0.0, 1.0);
        color = ring_color * ring + color * (1.0 - ring * ring_color.a);
        color *= 1.0 - inside;
    }
#if defined(DEBUG_FLAGS)
    if (tint == 1.0)
        color = vec4(0.0, 0.2, 0.0, 0.2) + color * 0.8;
#endif
    gl_FragColor = color * alpha;
}
"#;

/// The shader, compiled once per GPU and kept with its EGL context.
struct Program(Option<GlesPixelProgram>);

pub(crate) fn program(renderer: &mut GlesRenderer) -> Option<GlesPixelProgram> {
    let data = renderer.egl_context().user_data();
    if let Some(Program(program)) = data.get::<Program>() {
        return program.clone();
    }
    let uniforms = [
        ("frame", UniformType::_4f),
        ("radius", UniformType::_1f),
        ("shade0", UniformType::_4f),
        ("shade1", UniformType::_4f),
        ("strength", UniformType::_2f),
        ("ring_color", UniformType::_4f),
        ("ring_width", UniformType::_1f),
        ("edge_color", UniformType::_4f),
        ("edge_width", UniformType::_1f),
        ("front", UniformType::_1f),
    ]
    .map(|(name, kind)| UniformName::new(name, kind));
    let compiled = renderer
        .compile_custom_pixel_shader(SHADER, &uniforms)
        .inspect_err(|error| tracing::warn!(?error, "no window depth: the shader did not compile"))
        .ok();
    renderer
        .egl_context()
        .user_data()
        .insert_if_missing(|| Program(compiled.clone()));
    compiled
}

/// Which side of the window an element draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    /// The shadow and ring, behind it.
    Back,
    /// The edge, in front of it.
    Front,
}

/// One side of a window's depth, in physical pixels on the view.
pub(crate) struct Shape {
    pub side: Side,
    /// What the element covers (clipped to where it may show).
    pub area: Rectangle<i32, Physical>,
    /// The window's frame, relative to `area`, and its corner radius.
    pub frame: Rectangle<f64, Physical>,
    pub radius: f64,
    /// The shadow, in physical pixels (Back).
    pub shadow: super::style::Shadow,
    /// The ring (Back) or the edge (Front), its width in physical pixels.
    pub line: Line,
}

pub(crate) struct DepthElement {
    id: Id,
    commit: CommitCounter,
    program: GlesPixelProgram,
    area: Rectangle<i32, Physical>,
    /// Element-local: what is never drawn.
    holes: Vec<Rectangle<i32, Physical>>,
    uniforms: Vec<Uniform<'static>>,
}

fn premultiplied(color: [f32; 4]) -> [f32; 4] {
    let [r, g, b, a] = color;
    [r * a, g * a, b * a, a]
}

impl DepthElement {
    pub(crate) fn new(
        id: Id,
        commit: CommitCounter,
        program: GlesPixelProgram,
        shape: &Shape,
    ) -> Self {
        let f = shape.frame;
        let frame_px = geometry::outward(f);
        let band = match shape.side {
            Side::Back => 0.0,
            Side::Front => shape.line.width,
        };
        let holes = geometry::holes(frame_px, shape.radius, band);
        let layer = |i: usize| {
            let l = shape.shadow[i];
            [
                l.x as f32,
                l.y as f32,
                (l.blur / 2.0) as f32,
                l.spread as f32,
            ]
        };
        let front = shape.side == Side::Front;
        let (ring, edge) = if front {
            (Line::default(), shape.line)
        } else {
            (shape.line, Line::default())
        };
        let uniforms = vec![
            Uniform::new(
                "frame",
                [
                    f.loc.x as f32,
                    f.loc.y as f32,
                    f.size.w as f32,
                    f.size.h as f32,
                ],
            ),
            Uniform::new("radius", shape.radius as f32),
            Uniform::new("shade0", layer(0)),
            Uniform::new("shade1", layer(1)),
            Uniform::new(
                "strength",
                (shape.shadow[0].alpha as f32, shape.shadow[1].alpha as f32),
            ),
            Uniform::new("ring_color", premultiplied(ring.color)),
            Uniform::new("ring_width", ring.width as f32),
            Uniform::new("edge_color", premultiplied(edge.color)),
            Uniform::new("edge_width", edge.width as f32),
            Uniform::new("front", if front { 1.0f32 } else { 0.0 }),
        ];
        Self {
            id,
            commit,
            program,
            area: shape.area,
            holes,
            uniforms,
        }
    }

    fn local(&self) -> Rectangle<i32, Physical> {
        Rectangle::from_size(self.area.size)
    }
}

impl Element for DepthElement {
    fn id(&self) -> &Id {
        &self.id
    }

    fn current_commit(&self) -> CommitCounter {
        self.commit
    }

    fn src(&self) -> Rectangle<f64, Buffer> {
        Rectangle::from_size(Size::from((
            f64::from(self.area.size.w),
            f64::from(self.area.size.h),
        )))
    }

    fn geometry(&self, _scale: Scale<f64>) -> Rectangle<i32, Physical> {
        self.area
    }

    // A new look damages the bands only: the window covers the rest.
    fn damage_since(
        &self,
        _scale: Scale<f64>,
        commit: Option<CommitCounter>,
    ) -> DamageSet<i32, Physical> {
        if commit == Some(self.commit) {
            return DamageSet::default();
        }
        DamageSet::from_slice(&geometry::bands(self.local(), &self.holes))
    }

    fn opaque_regions(&self, _scale: Scale<f64>) -> OpaqueRegions<i32, Physical> {
        OpaqueRegions::default()
    }

    fn kind(&self) -> Kind {
        Kind::Unspecified
    }
}

impl<R> RenderElement<R> for DepthElement
where
    R: Renderer + GlesAccess,
{
    fn draw(
        &self,
        frame: &mut R::Frame<'_, '_>,
        _src: Rectangle<f64, Buffer>,
        dst: Rectangle<i32, Physical>,
        damage: &[Rectangle<i32, Physical>],
        _opaque_regions: &[Rectangle<i32, Physical>],
    ) -> Result<(), R::Error> {
        let damage =
            Rectangle::subtract_rects_many(damage.iter().copied(), self.holes.iter().copied());
        if damage.is_empty() {
            return Ok(());
        }
        let size = Size::<i32, Buffer>::from((dst.size.w, dst.size.h));
        let src = Rectangle::from_size(size.to_f64());
        R::gles_frame(frame)
            .render_pixel_shader_to(
                &self.program,
                src,
                dst,
                size,
                Some(&damage),
                1.0,
                &self.uniforms,
            )
            .map_err(R::gles_error)
    }

    // Shaded, so never handed to a plane.
    fn underlying_storage(&self, _renderer: &mut R) -> Option<UnderlyingStorage<'_>> {
        None
    }
}
