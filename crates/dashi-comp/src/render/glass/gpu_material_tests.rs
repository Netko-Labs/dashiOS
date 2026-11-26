//! The material on a real GPU, offscreen (gpu_tests.rs has the harness): a solid pane is its twin
//! with the rim inside and the hairline outside, a third layer of glass is drawn solid, and a fresh
//! pane's tone is read at once, still or moving. Ignored by default, like the others.

use std::time::{Duration, Instant};

use smithay::{
    backend::renderer::{element::Id, gles::GlesRenderer, utils::CommitCounter},
    utils::{Physical, Rectangle, Size},
};

use super::{
    element::{GlassElement, Owner, PaneKey},
    frost,
    frost::Frame,
    gpu_tests::{H, W, at, draw, rect, renderer, solid},
    style::Look,
};
use crate::render::DashiElement;

fn key(index: usize) -> PaneKey {
    PaneKey {
        owner: Owner::Shell("dashi.material".into()),
        index,
    }
}

/// A look with a white rim and a black hairline, 2 px each, and a twin.
fn material() -> Look {
    Look {
        noise: 0.0,
        rim: (2.0, [[1.0, 1.0, 1.0, 1.0]; 3]),
        keel: (2.0, [0.0, 0.0, 0.0, 1.0]),
        ..Look::plain(0.0, 24.0)
    }
}

fn pane(index: usize, at: Rectangle<i32, Physical>, look: Look) -> DashiElement<GlesRenderer> {
    let twin = Some([0.2, 0.4, 0.6]);
    DashiElement::Glass(GlassElement::new(key(index), at, look, 1.0).clipped(None, twin))
}

fn grey(ids: &Id, commit: CommitCounter) -> DashiElement<GlesRenderer> {
    solid(ids, commit, rect(0, 0, W, H), [0.5, 0.5, 0.5, 1.0])
}

#[test]
#[ignore = "needs a GPU"]
fn a_solid_pane_is_its_twin_inside_a_rim_and_a_hairline() {
    let mut renderer = renderer();
    let id = Id::new();
    let look = Look {
        solid: Some([0.2, 0.4, 0.6]),
        ..material()
    };
    let mut elements = vec![
        pane(0, rect(100, 100, 200, 100), look),
        grey(&id, CommitCounter::default()),
    ];
    let done = frost(
        &mut renderer,
        "material",
        Size::from((W, H)),
        Frame {
            scale: 1.0,
            deepest: None,
            now: Instant::now(),
        },
        &mut elements,
    )
    .expect("frosted");
    assert_eq!(
        (done.panes, done.blurred),
        (1, 0),
        "a solid pane needs no blur"
    );
    let picture = draw(&mut renderer, &elements);
    let middle = at(&picture, 200, 150);
    assert!(
        middle[0].abs_diff(51) <= 2 && middle[1].abs_diff(102) <= 2 && middle[2].abs_diff(153) <= 2,
        "{middle:?}"
    );
    // The rim, just inside the top edge: white over the twin.
    assert!(
        at(&picture, 200, 100)[0] > 200,
        "rim {:?}",
        at(&picture, 200, 100)
    );
    // The hairline, just outside the bottom edge: black over the grey.
    assert!(
        at(&picture, 200, 200)[0] < 40,
        "hairline {:?}",
        at(&picture, 200, 200)
    );
    // Past it, the grey as it is.
    assert_eq!(at(&picture, 200, 210), [128, 128, 128, 255]);
}

#[test]
#[ignore = "needs a GPU"]
fn a_third_layer_of_glass_is_drawn_solid() {
    let mut renderer = renderer();
    let id = Id::new();
    let mut elements = vec![
        pane(2, rect(140, 140, 100, 60), material()),
        pane(1, rect(120, 120, 140, 100), material()),
        pane(0, rect(100, 100, 200, 140), material()),
        grey(&id, CommitCounter::default()),
    ];
    let done = frost(
        &mut renderer,
        "layers",
        Size::from((W, H)),
        Frame {
            scale: 1.0,
            deepest: Some(2),
            now: Instant::now(),
        },
        &mut elements,
    )
    .expect("frosted");
    assert_eq!(
        (done.panes, done.blurred),
        (3, 2),
        "two frosted, the third solid"
    );
    let picture = draw(&mut renderer, &elements);
    let top = at(&picture, 190, 170);
    assert!(
        top[0].abs_diff(51) <= 2 && top[2].abs_diff(153) <= 2,
        "{top:?}"
    );
}

/// Frost one red-behind pane at `now`, the red `level` bright and drawn anew when `commit` moves.
fn frost_red(
    renderer: &mut GlesRenderer,
    id: &Id,
    (commit, level): (CommitCounter, f32),
    now: Instant,
) -> super::frost::Frosting {
    let red = solid(id, commit, rect(0, 0, W, H), [level, 0.1, 0.1, 1.0]);
    let mut elements = vec![pane(0, rect(100, 50, 200, 200), material()), red];
    let frame = Frame {
        scale: 1.0,
        deepest: None,
        now,
    };
    frost(renderer, "tone", Size::from((W, H)), frame, &mut elements).expect("frosted")
}

#[test]
#[ignore = "needs a GPU"]
fn a_fresh_pane_on_a_still_screen_hears_its_tone_at_its_first_frosting() {
    let mut renderer = renderer();
    let id = Id::new();
    let start = Instant::now();
    let first = frost_red(&mut renderer, &id, (CommitCounter::default(), 0.8), start);
    assert_eq!(first.tones.len(), 1, "{:?}", first.tones);
    let [r, g, b] = first.tones[0].1;
    assert!(r > 150 && g < 60 && b < 60, "{:?}", first.tones[0].1);
    assert!(!first.tone_due);
    // Still: nothing new to say, nothing due.
    let next = frost_red(
        &mut renderer,
        &id,
        (CommitCounter::default(), 0.8),
        start + Duration::from_millis(17),
    );
    assert!(next.tones.is_empty() && !next.tone_due);
}

/// The kit's run, after a video behind (dashi-0.10.0-review/29-glass-tone): blurred again on every
/// frame from the first, the pane still hears its tone at once, then once a second.
#[test]
#[ignore = "needs a GPU"]
fn a_fresh_pane_over_a_moving_backdrop_hears_its_tone_at_once_then_each_second() {
    let mut renderer = renderer();
    let id = Id::new();
    let start = Instant::now();
    let mut commit = CommitCounter::default();
    let mut heard = Vec::new();
    for n in 0..70u32 {
        commit.increment();
        let level = 0.3 + 0.01 * n as f32;
        let now = start + Duration::from_micros(16_667 * u64::from(n));
        let done = frost_red(&mut renderer, &id, (commit, level), now);
        assert_eq!(done.blurred, 1, "blurred again at {n}");
        if !done.tones.is_empty() {
            heard.push(n);
        }
    }
    assert_eq!(heard.first(), Some(&0), "at once: {heard:?}");
    assert_eq!(heard.len(), 2, "then once a second: {heard:?}");
}
