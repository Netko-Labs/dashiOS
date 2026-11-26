use super::*;

#[test]
fn a_pane_is_solid_but_its_corners_and_never_empty() {
    let square = solid((100, 40).into(), 0.0);
    assert_eq!(
        square,
        vec![Rectangle::new((0, 0).into(), (100, 40).into())]
    );
    let round = solid((100, 40).into(), 10.0);
    assert_eq!(round.len(), 3);
    assert!(round.iter().all(|band| !band.is_empty()));
    let area: i32 = round.iter().map(|band| band.size.w * band.size.h).sum();
    assert_eq!(area, 100 * 20 + 2 * 80 * 10);
    // A radius past half the height is held to it.
    assert!(
        solid((100, 40).into(), 90.0)
            .iter()
            .all(|band| !band.is_empty())
    );
}

fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
    Rectangle::new((x, y).into(), (w, h).into())
}

#[test]
fn the_hairline_is_outside_and_never_opaque() {
    // A 100 × 40 pane with a 1 px hairline is drawn 102 × 42; its opaque part is the pane's.
    let bands = opaque(rect(9, 9, 102, 42), 1, 0.0, None);
    assert_eq!(bands, vec![rect(1, 1, 100, 40)]);
    let round = opaque(rect(9, 9, 102, 42), 1, 10.0, None);
    assert!(round.iter().all(|band| !band.is_empty()));
    assert!(round.iter().all(|band| band.loc.x >= 1 && band.loc.y >= 1));
}

#[test]
fn a_clipped_pane_is_opaque_only_where_its_window_keeps_it_whole() {
    // A sidebar 200 × 600 in a window whose bottom corners are cut 12 round.
    let clip = Clip {
        rect: rect(0, 0, 800, 600),
        radii: (0.0, 12.0),
    };
    let outer = rect(-1, -1, 202, 602);
    let bands = opaque(outer, 1, 0.0, Some(clip));
    assert!(!bands.is_empty() && bands.iter().all(|band| !band.is_empty()));
    // Nothing opaque reaches the window's cut corners (12 rows at the top and bottom).
    for band in &bands {
        let top = band.loc.y + outer.loc.y;
        assert!(top >= 12 && top + band.size.h <= 600 - 12, "{band:?}");
    }
    // A clip that leaves nothing whole leaves nothing opaque, and no empty band.
    let thin = Clip {
        rect: rect(0, 0, 800, 20),
        radii: (12.0, 12.0),
    };
    assert!(opaque(rect(-1, -1, 202, 22), 1, 0.0, Some(thin)).is_empty());
}
