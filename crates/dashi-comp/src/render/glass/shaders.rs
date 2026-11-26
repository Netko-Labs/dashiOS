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
const PANE: &str = include_str!("pane.glsl");

/// The pane's uniforms for drawing `glass` into `dst`, the texture's part `crop`.
pub(super) fn uniforms(
    glass: &super::GlassElement,
    dst: smithay::utils::Rectangle<i32, smithay::utils::Physical>,
    crop: (f32, f32, f32, f32),
) -> Vec<Uniform<'static>> {
    let look = glass.look;
    let outer = glass.outer();
    // What is drawn is the pane and its hairline (or what its cut keeps), as big as `dst` (it may
    // be scaled); the pane's shape is the whole pane, wherever it is from what is drawn.
    let s = dst.size.w as f32 / outer.size.w.max(1) as f32;
    let at = glass.geometry.loc - outer.loc;
    let (x, y) = (at.x as f32 * s, at.y as f32 * s);
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
        Uniform::new("pane", (x, y, w, h)),
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
        Uniform::new("floor_reach", look.reach as f32 * s),
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
                    UniformName::new("floor_reach", UniformType::_1f),
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
