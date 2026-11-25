//! The glass's shaders, as smithay texture shaders (each handles its
//! `EXTERNAL`, `NO_ALPHA` and `DEBUG_FLAGS` variants), compiled once per GPU
//! and kept with its EGL context.
//!
//! The blur is the dual filter ("dual Kawase"): halve the picture a few times
//! with five taps each, then double it back with eight, each tap between
//! texels so the GPU's bilinear filter averages four for one. It is
//! described in Marius Bjørge's talk "Bandwidth-Efficient Rendering"
//! (SIGGRAPH 2015); these are written from that description.

use smithay::backend::renderer::gles::{GlesRenderer, GlesTexProgram, UniformName, UniformType};

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

/// The pane on screen: the blurred picture, its colours lifted, the tint laid over, a grain,
/// and the corners rounded (antialiased).
const PANE: &str = r#"
// The pane's size in the frame's pixels; the part of the texture drawn (x, y, width, height,
// as fractions of it); the corner radius in pixels.
uniform vec2 size;
uniform vec4 crop;
uniform float radius;
uniform float saturation;
uniform float brightness;
// Premultiplied.
uniform vec4 glass_tint;
uniform float noise;
// The words' luminance and the contrast they keep (0: no floor).
uniform vec2 floor_ink;

float grain(vec2 p) {
    return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}

float luma(vec3 c) {
    return dot(pow(c, vec3(2.2)), vec3(0.2126, 0.7152, 0.0722));
}

// Whether a ground of luminance `l` is short of what the words need.
bool short_of(float l, float need, bool dark) {
    return dark ? l < need : l > need;
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
    if (short_of(luma(mix(rgb, t, a)), need, dark)) {
        float lo = a;
        float hi = 1.0;
        for (int i = 0; i < 6; i++) {
            float mid = (lo + hi) * 0.5;
            if (short_of(luma(mix(rgb, t, mid)), need, dark)) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        a = hi;
    }
    return mix(rgb, t, a);
}

void main() {
    vec4 color = texture2D(tex, v_coords);
    vec3 rgb = color.rgb;
    float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = clamp(mix(vec3(l), rgb, saturation) * brightness, 0.0, 1.0);
    rgb = tinted(rgb);
    vec2 local = (v_coords - crop.xy) / crop.zw;
    vec2 p = local * size;
    rgb += (grain(p) - 0.5) * noise;
    vec2 q = abs(p - size * 0.5) - (size * 0.5 - vec2(radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float cover = clamp(0.5 - d, 0.0, 1.0);
    gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0) * cover * alpha;
}
"#;

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
                    UniformName::new("size", UniformType::_2f),
                    UniformName::new("crop", UniformType::_4f),
                    UniformName::new("radius", UniformType::_1f),
                    UniformName::new("saturation", UniformType::_1f),
                    UniformName::new("brightness", UniformType::_1f),
                    UniformName::new("floor_ink", UniformType::_2f),
                    UniformName::new("glass_tint", UniformType::_4f),
                    UniformName::new("noise", UniformType::_1f),
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
