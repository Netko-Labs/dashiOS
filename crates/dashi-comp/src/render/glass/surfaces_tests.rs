use smithay::{
    reexports::wayland_server::Display,
    wayland::compositor::{Cacheable, RectangleKind, RegionAttributes},
};

use super::*;
use crate::{
    ipc::protocol::read,
    render::glass::style::{GlassStyleParams, parse, tests::example},
};

fn style(mode: &str) -> Style {
    parse(&read::<GlassStyleParams>(example(mode)).unwrap()).unwrap()
}

fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Logical> {
    Rectangle::new((x, y).into(), (w, h).into())
}

fn pane(rect: Rectangle<i32, Logical>, radius: u32, level: Level) -> ClientPane {
    ClientPane {
        rect,
        radius,
        level,
    }
}

#[test]
fn a_commit_applies_what_changed_and_keeps_the_rest() {
    let display = Display::<()>::new().unwrap();
    let dh = display.handle();
    let mut current = SurfaceGlass::default();
    let mut pending = SurfaceGlass {
        region: Some(vec![rect(0, 0, 100, 30)]),
        panes: Some(vec![pane(rect(0, 0, 100, 30), 0, Level::Thin)]),
    };
    pending.commit(&dh).merge_into(&mut current, &dh);
    assert_eq!(current.panes.as_ref().unwrap().len(), 1);
    // Nothing pending is left: a commit with no add_pane keeps the panes.
    assert!(pending.panes.is_none() && pending.region.is_none());
    pending.commit(&dh).merge_into(&mut current, &dh);
    assert_eq!(current.panes.as_ref().unwrap().len(), 1);
    // `clear` (an empty list) then a commit removes them; the region stays until set again.
    pending.panes = Some(Vec::new());
    pending.commit(&dh).merge_into(&mut current, &dh);
    assert_eq!(current.panes, Some(Vec::new()));
    assert_eq!(current.region, Some(vec![rect(0, 0, 100, 30)]));
}

#[test]
fn a_region_is_its_rectangles_or_their_bounds() {
    assert!(region_rects(None).is_empty());
    let two = RegionAttributes {
        rects: vec![
            (RectangleKind::Add, rect(0, 0, 10, 10)),
            (RectangleKind::Add, rect(20, 0, 10, 10)),
            (RectangleKind::Add, rect(5, 5, 0, 0)),
        ],
    };
    assert_eq!(region_rects(Some(&two)).len(), 2);
    let cut = RegionAttributes {
        rects: vec![
            (RectangleKind::Add, rect(0, 0, 10, 10)),
            (RectangleKind::Add, rect(20, 0, 10, 10)),
            (RectangleKind::Subtract, rect(2, 2, 2, 2)),
        ],
    };
    assert_eq!(region_rects(Some(&cut)), vec![rect(0, 0, 30, 10)]);
    let many = RegionAttributes {
        rects: (0..40)
            .map(|i| (RectangleKind::Add, rect(i, 0, 1, 1)))
            .collect(),
    };
    assert_eq!(region_rects(Some(&many)), vec![rect(0, 0, 40, 1)]);
}

#[test]
fn panes_are_clipped_and_their_radius_held_never_empty() {
    let glass = SurfaceGlass {
        region: Some(vec![rect(0, 0, 400, 400)]),
        panes: Some(vec![
            pane(rect(-10, 0, 200, 40), 100, Level::Regular),
            pane(rect(500, 0, 10, 10), 4, Level::Thin),
            pane(rect(0, 0, 0, 40), 4, Level::Thin),
        ]),
    };
    let looks = looks(&glass, (300, 300).into(), &style("frosted"));
    // The one off the surface and the empty one are dropped.
    assert_eq!(looks.len(), 1);
    let (at, look, level) = looks[0];
    assert_eq!(at, rect(0, 0, 190, 40));
    assert_eq!(look.radius, 20.0);
    assert_eq!(level, Some(Level::Regular));
    assert!(look.tint[3] > 0.5);
}

#[test]
fn a_region_alone_is_the_apps_glass_and_panes_win_over_it() {
    let region_only = SurfaceGlass {
        region: Some(vec![rect(0, 0, 100, 100), rect(0, 100, 50, 50)]),
        panes: None,
    };
    let looks_of = |glass: &SurfaceGlass, mode: &str| looks(glass, (200, 200).into(), &style(mode));
    let apps = looks_of(&region_only, "frosted");
    assert_eq!(apps.len(), 2);
    assert!(apps.iter().all(|(_, look, level)| {
        level.is_none() && look.tint == [0.0; 4] && look.radius == 0.0
    }));
    // Solid: an app's own fill shows; nothing under it.
    assert!(looks_of(&region_only, "solid").is_empty());
    let both = SurfaceGlass {
        panes: Some(vec![pane(rect(0, 0, 80, 80), 8, Level::Paper)]),
        ..region_only
    };
    let mine = looks_of(&both, "frosted");
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].2, Some(Level::Paper));
    // An empty list of panes is no panes: the region speaks again.
    let cleared = SurfaceGlass {
        panes: Some(Vec::new()),
        ..both
    };
    assert_eq!(looks_of(&cleared, "frosted").len(), 2);
}
