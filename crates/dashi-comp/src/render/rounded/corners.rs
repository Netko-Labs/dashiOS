//! Where a rounded surface is not opaque: the corners its shader cuts.
//!
//! A window that claimed no opaque region had everything behind it drawn
//! again on each of its frames: the windows under it, their shadows, the
//! wallpaper. One window behind a scrolling one cost dashi-comp 70% more per
//! frame (dashi-0.8.0-review/03-bugs/cpu).

use smithay::utils::{Physical, Point, Rectangle, Size};

/// The parts of a surface of `size` its shader may fade: from each cut corner of the window's
/// box (`window`: x, y, width, height as fractions of the surface) out to the surface's edges,
/// `reach` pixels (the radius) into the box. The shader fades by distance from the corner's
/// centre wherever a pixel is past the box's last `radius` both ways, beyond the box too.
pub(super) fn cut(
    size: Size<i32, Physical>,
    window: [f32; 4],
    reach: i32,
    top: bool,
) -> Vec<Rectangle<i32, Physical>> {
    let (w, h) = (size.w.max(1), size.h.max(1));
    let [x, y, bw, bh] = window;
    // The box, widened to whole pixels; the cut one pixel deeper than the radius (antialiasing).
    let left = (x * w as f32).floor() as i32;
    let upper = (y * h as f32).floor() as i32;
    let right = ((x + bw) * w as f32).ceil() as i32;
    let lower = ((y + bh) * h as f32).ceil() as i32;
    let deep = reach.max(0) + 1;
    let span = |from: (i32, i32), to: (i32, i32)| {
        Rectangle::from_extremities(Point::from(from), Point::from(to))
    };
    let (far_x, far_y) = (w.max(right), h.max(lower));
    let (near_x, near_y) = (left.min(0), upper.min(0));
    let mut cut = vec![
        span((near_x, lower - deep), (left + deep, far_y)),
        span((right - deep, lower - deep), (far_x, far_y)),
    ];
    if top {
        cut.push(span((near_x, near_y), (left + deep, upper + deep)));
        cut.push(span((right - deep, near_y), (far_x, upper + deep)));
    }
    cut
}

/// `opaque` (a surface's opaque rectangles) without what is `cut`.
pub(super) fn opaque_but(
    opaque: impl IntoIterator<Item = Rectangle<i32, Physical>>,
    cut: Vec<Rectangle<i32, Physical>>,
) -> Vec<Rectangle<i32, Physical>> {
    Rectangle::subtract_rects_many(opaque, cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    fn covers(opaque: &[Rectangle<i32, Physical>], x: i32, y: i32) -> bool {
        opaque.iter().any(|r| r.contains(Point::from((x, y))))
    }

    #[test]
    fn a_rounded_window_is_opaque_but_for_its_cut_corners() {
        // A unified window's surface, 1000 by 600, the window's box all of it, radius 20.
        let whole = [0.0, 0.0, 1.0, 1.0];
        let size = Size::from((1000, 600));
        let opaque = opaque_but([rect(0, 0, 1000, 600)], cut(size, whole, 20, true));
        // What a scroll damages (the middle) is opaque: nothing behind it is drawn again.
        assert!(covers(&opaque, 500, 300));
        assert!(covers(&opaque, 500, 0) && covers(&opaque, 0, 300));
        assert!(covers(&opaque, 999, 300) && covers(&opaque, 500, 599));
        // All four corners show what is behind them.
        for (x, y) in [(0, 0), (999, 0), (0, 599), (999, 599), (20, 20), (979, 579)] {
            assert!(!covers(&opaque, x, y), "({x}, {y}) is in a cut corner");
        }
        assert!(covers(&opaque, 22, 22) && covers(&opaque, 977, 577));
        // Opaque rectangles never overlap, and cover all but the four 21 px squares.
        let area: i32 = opaque.iter().map(|r| r.size.w * r.size.h).sum();
        assert_eq!(area, 1000 * 600 - 4 * 21 * 21);
    }

    #[test]
    fn under_a_title_bar_only_the_bottom_corners_are_cut() {
        let whole = [0.0, 0.0, 1.0, 1.0];
        let opaque = opaque_but(
            [rect(0, 0, 400, 300)],
            cut(Size::from((400, 300)), whole, 10, false),
        );
        assert!(covers(&opaque, 0, 0) && covers(&opaque, 399, 0));
        assert!(!covers(&opaque, 0, 299) && !covers(&opaque, 399, 299));
    }

    #[test]
    fn a_surface_wider_than_its_window_is_cut_beyond_the_box_too() {
        // The surface carries 50 px of the client's own shadow around a 300 by 200 window.
        let window = [50.0 / 400.0, 50.0 / 300.0, 300.0 / 400.0, 200.0 / 300.0];
        let cut = cut(Size::from((400, 300)), window, 10, true);
        let opaque = opaque_but([rect(0, 0, 400, 300)], cut);
        // The shader fades everything past each corner, out to the surface's edge.
        assert!(!covers(&opaque, 0, 0) && !covers(&opaque, 55, 55));
        assert!(!covers(&opaque, 399, 299) && !covers(&opaque, 345, 245));
        assert!(covers(&opaque, 200, 150) && covers(&opaque, 200, 10));
    }

    #[test]
    fn a_surface_that_claims_nothing_stays_see_through() {
        let whole = [0.0, 0.0, 1.0, 1.0];
        assert!(opaque_but([], cut(Size::from((400, 300)), whole, 10, true)).is_empty());
    }
}
