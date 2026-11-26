//! The glass's shaders, as smithay texture shaders (each handles its
//! `EXTERNAL`, `NO_ALPHA` and `DEBUG_FLAGS` variants), compiled once per GPU
//! and kept with its EGL context.
//!
//! The blur is the dual filter ("dual Kawase"): halve the picture a few times
//! with five taps each, then double it back with eight, each tap between
//! texels so the GPU's bilinear filter averages four for one. It is
//! described in Marius Bjørge's talk "Bandwidth-Efficient Rendering"
//! (SIGGRAPH 2015); these are written from that description.

use smithay::backend::renderer::gles::{
    GlesRenderer, GlesTexProgram, Uniform, UniformName, UniformType,
};

use super::gl::Passes;

/// What each of the glass's shaders starts with: smithay's texture shader inputs.
const HEAD: &str = r#"
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
"#;

/// Halving: the middle, four times, and the four diagonal corners (plain GL, gl.rs).
const DOWN: &str = r#"
void main() {
    vec2 uv = v_coords;
    vec4 sum = texture2D(tex, uv) * 4.0;
    sum += texture2D(tex, uv - half_px);
    sum += texture2D(tex, uv + half_px);
    sum += texture2D(tex, uv + vec2(half_px.x, -half_px.y));
    sum += texture2D(tex, uv - vec2(half_px.x, -half_px.y));
    gl_FragColor = sum / 8.0;
}
"#;

/// Doubling: four taps on the axes, two away, and four on the diagonals, twice as heavy (gl.rs).
const UP: &str = r#"
void main() {
    vec2 uv = v_coords;
    vec2 h = half_px;
    vec4 sum = texture2D(tex, uv + vec2(-h.x * 2.0, 0.0));
    sum += texture2D(tex, uv + vec2(-h.x, h.y)) * 2.0;
    sum += texture2D(tex, uv + vec2(0.0, h.y * 2.0));
    sum += texture2D(tex, uv + vec2(h.x, h.y)) * 2.0;
    sum += texture2D(tex, uv + vec2(h.x * 2.0, 0.0));
    sum += texture2D(tex, uv + vec2(h.x, -h.y)) * 2.0;
    sum += texture2D(tex, uv + vec2(0.0, -h.y * 2.0));
    sum += texture2D(tex, uv + vec2(-h.x, -h.y)) * 2.0;
    gl_FragColor = sum / 12.0;
}
"#;

/// The pane on screen: the blurred picture, its colours lifted, the tint laid over (raised where
/// the words need it, the grain counted), a grain, the rim inside its edge and the hairline
/// outside it, its corners rounded and cut to its window's (all antialiased); or, solid, its
/// twin's colour with the same rim and hairline.
const PANE: &str = r#"
// The part of the texture drawn (x, y, width, height, as fractions of it).
uniform vec4 crop;
// The pane within what is drawn (its hairline around it), in the frame's pixels.
uniform vec4 pane;
// What is drawn's size, the pane's corner radius, the grain.
uniform vec4 shape;
// Saturation, brightness, the rim's width, the hairline's.
uniform vec4 lift;
// Premultiplied.
uniform vec4 glass_tint;
// The words' luminance and the contrast they keep (0: no floor).
uniform vec2 floor_ink;
// The solid twin (rgb), and whether it is drawn instead (a).
uniform vec4 solid;
// The rim from the top through the middle to the bottom, and the hairline (premultiplied).
uniform vec4 rim_top;
uniform vec4 rim_mid;
uniform vec4 rim_bot;
uniform vec4 keel;
// The window's frame the pane is cut to (pane coordinates; zero size: none), its radii top
// and bottom.
uniform vec4 clip;
uniform vec2 clip_radii;

float grain(vec2 p) {
    return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}

float luma(vec3 c) {
    return dot(pow(clamp(c, 0.0, 1.0), vec3(2.2)), vec3(0.2126, 0.7152, 0.0722));
}

// Whether a ground `c` is short of what the words need, the grain at its worst for them.
bool short_of(vec3 c, float need, bool dark) {
    float g = shape.w * 0.5;
    return dark ? luma(c - vec3(g)) < need : luma(c + vec3(g)) > need;
}

// The tint laid over `rgb`, raised (never lowered) until the words keep their ratio.
vec3 tinted(vec3 rgb) {
    float a = glass_tint.a;
    if (floor_ink.y <= 0.0 || a <= 0.0) {
        return rgb * (1.0 - a) + glass_tint.rgb;
    }
    vec3 t = glass_tint.rgb / a;
    float ink = floor_ink.x;
    bool dark = ink < 0.18;
    float need = dark ? floor_ink.y * (ink + 0.05) - 0.05 : (ink + 0.05) / floor_ink.y - 0.05;
    if (short_of(mix(rgb, t, a), need, dark)) {
        float lo = a;
        float hi = 1.0;
        for (int i = 0; i < 6; i++) {
            float mid = (lo + hi) * 0.5;
            if (short_of(mix(rgb, t, mid), need, dark)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        a = hi;
    }
    return mix(rgb, t, a);
}

// The signed distance from `p` to a box at `at`, `size` big, its corners `r` round.
float rounded(vec2 p, vec2 at, vec2 size, float r) {
    vec2 q = abs(p - at - size * 0.5) - (size * 0.5 - vec2(r));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
    vec2 local = (v_coords - crop.xy) / crop.zw;
    vec2 p = local * shape.xy - pane.xy;
    vec3 rgb;
    if (solid.a > 0.5) {
        rgb = solid.rgb;
    } else {
        rgb = texture2D(tex, v_coords).rgb;
        float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        rgb = clamp(mix(vec3(l), rgb, lift.x) * lift.y, 0.0, 1.0);
        rgb = tinted(rgb);
        rgb += (grain(p) - 0.5) * shape.w;
    }
    float d = rounded(p, vec2(0.0), pane.zw, shape.z);
    float inside = clamp(0.5 - d, 0.0, 1.0);
    // The rim: a band `lift.z` wide inside the edge, light from above.
    float band = inside - clamp(0.5 - d - lift.z, 0.0, 1.0);
    float t = clamp(p.y / max(pane.w, 1.0), 0.0, 1.0);
    vec4 rim = t < 0.5 ? mix(rim_top, rim_mid, t * 2.0) : mix(rim_mid, rim_bot, t * 2.0 - 1.0);
    rgb = clamp(rgb, 0.0, 1.0) * (1.0 - rim.a * band) + rim.rgb * band;
    // The hairline: a band `lift.w` wide outside it.
    float outside = clamp(0.5 - d + lift.w, 0.0, 1.0) - inside;
    vec4 color = vec4(rgb, 1.0) * inside + keel * outside;
    if (clip.z > 0.0) {
        float r = p.y < clip.y + clip.w * 0.5 ? clip_radii.x : clip_radii.y;
        color *= clamp(0.5 - rounded(p, clip.xy, clip.zw, r), 0.0, 1.0);
    }
    gl_FragColor = color * alpha;
}
"#;

/// The pane's uniforms for drawing `glass` into `dst`, the texture's part `crop`.
pub(super) fn uniforms(
    glass: &super::GlassElement,
    dst: smithay::utils::Rectangle<i32, smithay::utils::Physical>,
    crop: (f32, f32, f32, f32),
) -> Vec<Uniform<'static>> {
    let look = glass.look;
    let outer = glass.outer();
    // What is drawn is the pane and its hairline, as big as `dst` (it may be scaled).
    let s = dst.size.w as f32 / outer.size.w.max(1) as f32;
    let k = glass.keel() as f32 * s;
    let (w, h) = (
        glass.geometry.size.w as f32 * s,
        glass.geometry.size.h as f32 * s,
    );
    let clip = glass.clip.map_or((0.0, 0.0, 0.0, 0.0), |clip| {
        let at = clip.rect.loc - glass.geometry.loc;
        (
            at.x as f32 * s,
            at.y as f32 * s,
            clip.rect.size.w as f32 * s,
            clip.rect.size.h as f32 * s,
        )
    });
    let radii = glass
        .clip
        .map_or((0.0, 0.0), |clip| (clip.radii.0 * s, clip.radii.1 * s));
    let [r, g, b] = look.solid.unwrap_or([0.0; 3]);
    let on = if look.solid.is_some() { 1.0 } else { 0.0 };
    let [top, middle, bottom] = look.rim.1;
    vec![
        Uniform::new("crop", crop),
        Uniform::new("pane", (k, k, w, h)),
        Uniform::new(
            "shape",
            (
                dst.size.w as f32,
                dst.size.h as f32,
                look.radius as f32 * s,
                look.noise,
            ),
        ),
        Uniform::new(
            "lift",
            (
                look.saturation,
                look.brightness,
                look.rim.0 as f32 * s,
                look.keel.0 as f32 * s,
            ),
        ),
        Uniform::new("glass_tint", look.tint),
        Uniform::new("floor_ink", look.floor),
        Uniform::new("solid", (r, g, b, on)),
        Uniform::new("rim_top", top),
        Uniform::new("rim_mid", middle),
        Uniform::new("rim_bot", bottom),
        Uniform::new("keel", look.keel.1),
        Uniform::new("clip", clip),
        Uniform::new("clip_radii", radii),
    ]
}

/// The programs of one GPU: the blur's passes, and the pane's look.
#[derive(Clone)]
pub(super) struct Programs {
    pub passes: Passes,
    pub pane: GlesTexProgram,
}

struct Kept(Option<Programs>);

/// This GPU's programs, compiled the first time; none if they do not compile (no glass there).
pub(super) fn programs(renderer: &mut GlesRenderer) -> Option<Programs> {
    if let Some(Kept(kept)) = renderer.egl_context().user_data().get::<Kept>() {
        return kept.clone();
    }
    let compiled = (|| {
        Some(Programs {
            passes: super::gl::passes(renderer, DOWN, UP)?,
            pane: compile(
                renderer,
                PANE,
                &[
                    UniformName::new("crop", UniformType::_4f),
                    UniformName::new("pane", UniformType::_4f),
                    UniformName::new("shape", UniformType::_4f),
                    UniformName::new("lift", UniformType::_4f),
                    UniformName::new("glass_tint", UniformType::_4f),
                    UniformName::new("floor_ink", UniformType::_2f),
                    UniformName::new("solid", UniformType::_4f),
                    UniformName::new("rim_top", UniformType::_4f),
                    UniformName::new("rim_mid", UniformType::_4f),
                    UniformName::new("rim_bot", UniformType::_4f),
                    UniformName::new("keel", UniformType::_4f),
                    UniformName::new("clip", UniformType::_4f),
                    UniformName::new("clip_radii", UniformType::_2f),
                ],
            )?,
        })
    })();
    renderer
        .egl_context()
        .user_data()
        .insert_if_missing(|| Kept(compiled.clone()));
    compiled
}

fn compile(
    renderer: &mut GlesRenderer,
    body: &str,
    uniforms: &[UniformName<'_>],
) -> Option<GlesTexProgram> {
    renderer
        .compile_custom_texture_shader(format!("{HEAD}{body}"), uniforms)
        .inspect_err(|error| tracing::warn!(?error, "no glass: a shader did not compile"))
        .ok()
}
