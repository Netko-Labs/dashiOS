//! The glass on a real GPU, offscreen (EGL on a render node, no screen and
//! no session): what is behind a pane comes out blurred, the right way up,
//! and is blurred again only when it changes. Ignored by default, since CI
//! has no GPU: `cargo test -p dashi-comp -- --ignored glass::gpu`; with
//! `--nocapture`, `glass_costs` prints what a laptop-sized pane costs.

use std::time::Instant;

use smithay::{
    backend::{
        allocator::Fourcc,
        egl::{EGLContext, EGLDevice, EGLDisplay},
        renderer::{
            Bind, ExportMem, Offscreen, TextureMapping,
            damage::OutputDamageTracker,
            element::{Id, Kind, solid::SolidColorRenderElement},
            gles::{GlesRenderer, GlesTexture},
            utils::CommitCounter,
        },
    },
    utils::{Physical, Rectangle, Size, Transform},
};

use super::{
    element::{GlassElement, PaneKey},
    frost,
    style::Look,
};
use crate::render::DashiElement;

pub(super) const W: i32 = 400;
pub(super) const H: i32 = 300;

pub(super) fn renderer() -> GlesRenderer {
    EGLDevice::enumerate()
        .expect("EGL devices")
        .find_map(|device| {
            // SAFETY: the display is used on this thread only, for the test's life.
            let display = unsafe { EGLDisplay::new(device) }.ok()?;
            let context = EGLContext::new(&display).ok()?;
            // SAFETY: the context is current on this thread only.
            unsafe { GlesRenderer::new(context) }.ok()
        })
        .expect("an EGL device that renders")
}

fn look(blur: f64) -> Look {
    Look::plain(12.0, blur)
}

fn pane(rect: Rectangle<i32, Physical>, blur: f64) -> DashiElement<GlesRenderer> {
    let key = PaneKey {
        owner: super::element::Owner::Shell("dashi.test".into()),
        index: 0,
    };
    DashiElement::Glass(GlassElement::new(key, rect, look(blur), 1.0))
}

pub(super) fn solid(
    id: &Id,
    commit: CommitCounter,
    rect: Rectangle<i32, Physical>,
    color: [f32; 4],
) -> DashiElement<GlesRenderer> {
    DashiElement::Solid(SolidColorRenderElement::new(
        id.clone(),
        rect,
        commit,
        color,
        Kind::Unspecified,
    ))
}

pub(super) fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
    Rectangle::new((x, y).into(), (w, h).into())
}

/// Red over the top half, blue under it, and a pane across the line between.
fn scene(ids: &[Id; 2], commit: CommitCounter, blur: f64) -> Vec<DashiElement<GlesRenderer>> {
    vec![
        pane(rect(100, 50, 200, 200), blur),
        solid(&ids[0], commit, rect(0, 0, W, H / 2), [1.0, 0.0, 0.0, 1.0]),
        solid(
            &ids[1],
            commit,
            rect(0, H / 2, W, H / 2),
            [0.0, 0.0, 1.0, 1.0],
        ),
    ]
}

/// Draw `elements` on a W×H picture; RGBA rows, top down.
pub(super) fn draw(
    renderer: &mut GlesRenderer,
    elements: &[DashiElement<GlesRenderer>],
) -> Vec<[u8; 4]> {
    let size = (W, H).into();
    let mut texture: GlesTexture = renderer
        .create_buffer(Fourcc::Abgr8888, size)
        .expect("a buffer");
    let mut target = renderer.bind(&mut texture).expect("bound");
    let mut damage = OutputDamageTracker::new((W, H), 1.0, Transform::Normal);
    damage
        .render_output(renderer, &mut target, 0, elements, [0.0; 4])
        .expect("drawn");
    let mapping = renderer
        .copy_framebuffer(&target, Rectangle::from_size(size), Fourcc::Abgr8888)
        .expect("read back");
    let flipped = !mapping.flipped();
    let bytes = renderer.map_texture(&mapping).expect("mapped").to_vec();
    let mut rows: Vec<&[[u8; 4]]> = bytes.as_chunks::<4>().0.chunks(W as usize).collect();
    if flipped {
        rows.reverse();
    }
    rows.concat()
}

pub(super) fn at(picture: &[[u8; 4]], x: i32, y: i32) -> [u8; 4] {
    picture[(y * W + x) as usize]
}

#[test]
#[ignore = "needs a GPU"]
fn what_is_behind_comes_out_blurred_and_the_right_way_up() {
    let mut renderer = renderer();
    let ids = [Id::new(), Id::new()];
    let mut elements = scene(&ids, CommitCounter::default(), 24.0);
    let done = frost(
        &mut renderer,
        "test",
        Size::from((W, H)),
        (1.0, None),
        &mut elements,
    )
    .expect("frosted");
    assert_eq!((done.panes, done.blurred), (1, 1));
    let picture = draw(&mut renderer, &elements);
    // Outside the pane: as it is.
    assert_eq!(at(&picture, 20, 20), [255, 0, 0, 255]);
    assert_eq!(at(&picture, 20, 280), [0, 0, 255, 255]);
    // Inside, far from the line: mostly the colour behind, the right way up.
    let top = at(&picture, 200, 62);
    let bottom = at(&picture, 200, 238);
    assert!(top[0] > top[2] + 60, "the top of the pane is red: {top:?}");
    assert!(
        bottom[2] > bottom[0] + 60,
        "the bottom of the pane is blue: {bottom:?}"
    );
    // On the line: both, blurred together.
    let middle = at(&picture, 200, 150);
    assert!(
        middle[0] > 60 && middle[2] > 60,
        "the line is blurred: {middle:?}"
    );
    // A rounded corner shows what is behind, sharp.
    assert_eq!(at(&picture, 101, 51), [255, 0, 0, 255]);
}

#[test]
#[ignore = "needs a GPU"]
fn it_is_blurred_again_only_when_what_is_behind_changes() {
    let mut renderer = renderer();
    let ids = [Id::new(), Id::new()];
    let mut commit = CommitCounter::default();
    let mut frost_now = |commit: CommitCounter| {
        let mut elements = scene(&ids, commit, 24.0);
        frost(
            &mut renderer,
            "test",
            Size::from((W, H)),
            (1.0, None),
            &mut elements,
        )
        .expect("frosted")
    };
    assert_eq!(frost_now(commit).blurred, 1);
    assert_eq!(
        frost_now(commit).blurred,
        0,
        "nothing changed: the last blur is kept"
    );
    commit.increment();
    assert_eq!(frost_now(commit).blurred, 1, "what is behind changed");
}

/// What one pane costs, at the laptop's size: the launcher (680 × 412 points at 1.75) on a
/// 2880 × 1800 screen, blurred again every frame (something moves behind it), and at rest.
#[test]
#[ignore = "needs a GPU; prints numbers"]
fn glass_costs() {
    let mut renderer = renderer();
    let (sw, sh) = (2880, 1800);
    let ids = [Id::new(), Id::new()];
    let mut commit = CommitCounter::default();
    for blur in [10.0, 30.0, 60.0] {
        let mut elements = vec![
            pane(rect(845, 210, 1190, 721), blur * 1.75),
            solid(
                &ids[0],
                commit,
                rect(0, 0, sw, sh / 2),
                [0.9, 0.3, 0.1, 1.0],
            ),
            solid(
                &ids[1],
                commit,
                rect(0, sh / 2, sw, sh / 2),
                [0.1, 0.3, 0.9, 1.0],
            ),
        ];
        let mut time = |moving: bool, commit: &mut CommitCounter, each: bool| {
            let runs = 120;
            let started = Instant::now();
            for run in 0..runs {
                if moving {
                    commit.increment();
                    elements[1] = solid(
                        &ids[0],
                        *commit,
                        rect(0, 0, sw, sh / 2),
                        [0.9, 0.3, 0.1, 1.0],
                    );
                }
                frost(
                    &mut renderer,
                    "cost",
                    Size::from((sw, sh)),
                    (1.75, None),
                    &mut elements,
                )
                .expect("frosted");
                if !each && run + 1 < runs {
                    continue;
                }
                let _ = renderer.with_context(|gl| {
                    // SAFETY: the context is current (with_context).
                    unsafe { gl.Finish() }
                });
            }
            started.elapsed().as_secs_f64() * 1000.0 / f64::from(runs)
        };
        let latency = time(true, &mut commit, true);
        let moving = time(true, &mut commit, false);
        let still = time(false, &mut commit, false);
        println!(
            "glass_costs: blur {blur} pt: {moving:.3} ms a frame blurred again ({latency:.3} ms waiting for each), {still:.3} ms at rest"
        );
    }
}

/// The blur's passes alone, for the launcher's backdrop at the laptop's size, against `glass_costs`.
#[test]
#[ignore = "needs a GPU; prints numbers"]
fn blur_passes_cost() {
    let mut renderer = renderer();
    let programs = super::shaders::programs(&mut renderer).expect("compiled");
    for sigma in [17.5, 52.5, 105.0] {
        let (passes, spread) = super::kawase::plan(sigma);
        let size = (1280 / 2, 832 / 2).into();
        let backdrop: GlesTexture = renderer
            .create_buffer(Fourcc::Abgr8888, size)
            .expect("a buffer");
        let mut pyramid = super::kawase::Pyramid::new(&mut renderer, size, passes).expect("made");
        let runs = 120;
        let started = Instant::now();
        for _ in 0..runs {
            pyramid
                .blur(&mut renderer, &programs, &backdrop, spread)
                .expect("blurred");
        }
        let cpu = started.elapsed().as_secs_f64() * 1000.0 / f64::from(runs);
        let _ = renderer.with_context(|gl| {
            // SAFETY: the context is current (with_context).
            unsafe { gl.Finish() }
        });
        let all = started.elapsed().as_secs_f64() * 1000.0 / f64::from(runs);
        println!(
            "blur_passes_cost: sigma {sigma} px, {passes} passes: {cpu:.3} ms on the CPU, {all:.3} ms with the GPU done"
        );
    }
}
