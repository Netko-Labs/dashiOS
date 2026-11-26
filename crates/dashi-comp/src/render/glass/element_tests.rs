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
    let pane = rect(10, 10, 100, 40);
    let bands = opaque(rect(9, 9, 102, 42), pane, 0.0, None);
    assert_eq!(bands, vec![rect(1, 1, 100, 40)]);
    let round = opaque(rect(9, 9, 102, 42), pane, 10.0, None);
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
    let bands = opaque(outer, rect(0, 0, 200, 600), 0.0, Some(clip));
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
    assert!(opaque(rect(-1, -1, 202, 22), rect(0, 0, 200, 20), 0.0, Some(thin)).is_empty());
}

#[test]
fn a_cut_pane_draws_only_inside_its_cut_and_its_hairline_only_where_kept() {
    // A card 356 × 160 whose list shows only its top 60 (the area's foot over the Dock).
    let card = rect(100, 500, 356, 160);
    let cut = rect(90, 0, 400, 560);
    // The top and sides keep their hairline; the foot is cut straight at the list's edge.
    assert_eq!(outer(card, Some(cut), 1), rect(99, 499, 358, 61));
    assert_eq!(outer(card, None, 1), rect(99, 499, 358, 162));
    // Scrolled out of the list: nothing is drawn.
    assert!(outer(card, Some(rect(90, 0, 400, 400)), 1).is_empty());
    // Opaque only within what is drawn; its rounded top corners stay out.
    let drawn = outer(card, Some(cut), 1);
    let bands = opaque(drawn, card, 18.0, None);
    assert!(!bands.is_empty());
    for band in &bands {
        assert!(band.loc.y + band.size.h <= drawn.size.h, "{band:?}");
        assert!(!band.is_empty());
    }
    // No band reaches the top corners' 18 rows at the pane's left edge (x 1 in `drawn`).
    assert!(
        bands
            .iter()
            .all(|band| !(band.loc.x <= 1 && band.loc.y < 1 + 18))
    );
}
