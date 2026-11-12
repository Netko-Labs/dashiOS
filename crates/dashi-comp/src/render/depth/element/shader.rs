//! The depth shader, compiled once per GPU and kept with its EGL context.

use smithay::backend::renderer::gles::{GlesPixelProgram, GlesRenderer, UniformName, UniformType};

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
