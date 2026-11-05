//! The shader on a real GPU, offscreen (EGL on a render node, no screen and
//! no session): it compiles, and what it draws is where it should be.
//! Ignored by default, since CI has no GPU:
//! `cargo test -p dashi-comp -- --ignored depth::gpu`.

use smithay::{
    backend::{
        allocator::Fourcc,
        egl::{EGLContext, EGLDevice, EGLDisplay},
        renderer::{
            Bind, ExportMem, Offscreen, TextureMapping,
            damage::OutputDamageTracker,
            element::Id,
            gles::{GlesRenderer, GlesTexture},
            utils::CommitCounter,
        },
    },
    utils::{Rectangle, Transform},
};

use super::{
    element::{DepthElement, Shape, Side, program},
    style::{Layer, Line},
};

const SIZE: i32 = 200;

fn renderer() -> GlesRenderer {
    // The first device EGL can open: a GPU, or Mesa's software one.
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

/// Draw `shape` alone on a clear SIZE×SIZE picture; straight-ish RGBA rows, top down.
fn draw(renderer: &mut GlesRenderer, shape: &Shape) -> Vec<[u8; 4]> {
    let program = program(renderer).expect("the depth shader compiles");
    let element = DepthElement::new(Id::new(), CommitCounter::default(), program, shape);
    let size = (SIZE, SIZE).into();
    let mut texture: GlesTexture = renderer
        .create_buffer(Fourcc::Abgr8888, size)
        .expect("an offscreen buffer");
    let mut target = renderer.bind(&mut texture).expect("bound");
    let mut damage = OutputDamageTracker::new((SIZE, SIZE), 1.0, Transform::Normal);
    damage
        .render_output(renderer, &mut target, 0, &[&element], [0.0; 4])
        .expect("drawn");
    let mapping = renderer
        .copy_framebuffer(&target, Rectangle::from_size(size), Fourcc::Abgr8888)
        .expect("read back");
    let flipped = !mapping.flipped();
    let bytes = renderer.map_texture(&mapping).expect("mapped").to_vec();
    let pixels = bytes.as_chunks::<4>().0;
    let mut rows: Vec<&[[u8; 4]]> = pixels.chunks(SIZE as usize).collect();
    if flipped {
        rows.reverse();
    }
    rows.concat()
}

fn at(picture: &[[u8; 4]], x: i32, y: i32) -> [u8; 4] {
    picture[(y * SIZE + x) as usize]
}

fn frame() -> Rectangle<f64, smithay::utils::Physical> {
    Rectangle::new((50.0, 50.0).into(), (100.0, 100.0).into())
}

#[test]
#[ignore = "needs a GPU"]
fn the_shadow_falls_outside_the_window_only() {
    let mut renderer = renderer();
    let shadow = [
        Layer {
            y: 10.0,
            blur: 20.0,
            alpha: 0.5,
            ..Layer::default()
        },
        Layer::default(),
    ];
    let picture = draw(
        &mut renderer,
        &Shape {
            side: Side::Back,
            area: Rectangle::from_size((SIZE, SIZE).into()),
            frame: frame(),
            radius: 10.0,
            shadow,
            line: Line::default(),
        },
    );
    // Inside the window: nothing (the window covers it). Just inside a
    // rounded corner, nothing; in the corner it cuts off, the shadow.
    assert_eq!(at(&picture, 100, 100)[3], 0);
    assert_eq!(at(&picture, 56, 56)[3], 0);
    assert!(at(&picture, 51, 51)[3] > 0);
    // Just under it, shade; deeper below than above (the offset).
    let below = at(&picture, 100, 152)[3];
    let above = at(&picture, 100, 47)[3];
    assert!(below > 40, "below {below}");
    assert!(below > above, "below {below}, above {above}");
    // Black, and gone far away.
    assert_eq!(&at(&picture, 100, 152)[..3], &[0, 0, 0]);
    assert_eq!(at(&picture, 2, 2)[3], 0);
}

#[test]
#[ignore = "needs a GPU"]
fn the_edge_and_ring_sit_on_either_side_of_the_frame() {
    let mut renderer = renderer();
    let white = Line {
        color: [1.0, 1.0, 1.0, 1.0],
        width: 1.0,
    };
    let edge = draw(
        &mut renderer,
        &Shape {
            side: Side::Front,
            area: Rectangle::from_size((SIZE, SIZE).into()),
            frame: frame(),
            radius: 10.0,
            shadow: Default::default(),
            line: white,
        },
    );
    assert_eq!(at(&edge, 100, 50), [255, 255, 255, 255]);
    assert_eq!(at(&edge, 100, 51)[3], 0);
    assert_eq!(at(&edge, 100, 49)[3], 0);
    // The corner is rounded: its very corner pixel is outside the edge.
    assert_eq!(at(&edge, 50, 50)[3], 0);
    let ring = draw(
        &mut renderer,
        &Shape {
            side: Side::Back,
            area: Rectangle::from_size((SIZE, SIZE).into()),
            frame: frame(),
            radius: 10.0,
            shadow: Default::default(),
            line: Line {
                width: 2.0,
                ..white
            },
        },
    );
    assert_eq!(at(&ring, 100, 48), [255, 255, 255, 255]);
    assert_eq!(at(&ring, 100, 49), [255, 255, 255, 255]);
    assert_eq!(at(&ring, 100, 50)[3], 0);
    assert_eq!(at(&ring, 100, 46)[3], 0);
}
