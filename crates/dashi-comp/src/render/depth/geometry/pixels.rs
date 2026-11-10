//! Whole-pixel arithmetic for what is drawn: the rect that covers another, the
//! inside of a frame that never needs drawing, and the bands left to draw.

use smithay::utils::{Physical, Rectangle};

/// The rect in whole pixels that covers all of `rect`.
pub(crate) fn outward(rect: Rectangle<f64, Physical>) -> Rectangle<i32, Physical> {
    let (x0, y0) = (rect.loc.x.floor(), rect.loc.y.floor());
    let x1 = (rect.loc.x + rect.size.w).ceil();
    let y1 = (rect.loc.y + rect.size.h).ceil();
    Rectangle::new(
        (x0 as i32, y0 as i32).into(),
        ((x1 - x0) as i32, (y1 - y0) as i32).into(),
    )
}

/// The inside of a frame with rounded corners that a line `band` wide along
/// its edge (0: just the edge's antialiasing) never reaches: a plus, the
/// frame less its corners and edge. Element-local, like `frame`.
pub(crate) fn holes(
    frame: Rectangle<i32, Physical>,
    radius: f64,
    band: f64,
) -> Vec<Rectangle<i32, Physical>> {
    let edge = band.max(0.0).ceil() as i32 + 1;
    let corner = (radius.max(band)).ceil() as i32 + 1;
    let shrink = |dx: i32, dy: i32| {
        let (w, h) = (frame.size.w - 2 * dx, frame.size.h - 2 * dy);
        (w > 0 && h > 0)
            .then(|| Rectangle::new((frame.loc.x + dx, frame.loc.y + dy).into(), (w, h).into()))
    };
    [shrink(corner, edge), shrink(edge, corner)]
        .into_iter()
        .flatten()
        .collect()
}

/// The parts of `area` outside `holes`: what is drawn, and what is damaged
/// when the look changes.
pub(crate) fn bands(
    area: Rectangle<i32, Physical>,
    holes: &[Rectangle<i32, Physical>],
) -> Vec<Rectangle<i32, Physical>> {
    area.subtract_rects(holes.iter().copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    #[test]
    fn outward_covers_every_touched_pixel() {
        let r = outward(Rectangle::new((1.5, -0.25).into(), (2.0, 1.0).into()));
        assert_eq!(r, rect(1, -1, 3, 2));
        let whole = outward(Rectangle::new((2.0, 3.0).into(), (4.0, 5.0).into()));
        assert_eq!(whole, rect(2, 3, 4, 5));
    }

    #[test]
    fn holes_leave_the_corners_and_edges() {
        let frame = rect(10, 20, 200, 100);
        let holes = holes(frame, 12.0, 0.0);
        assert_eq!(holes, vec![rect(23, 21, 174, 98), rect(11, 33, 198, 74)]);
        // No corner pixel and no edge pixel is in a hole.
        for hole in &holes {
            assert!(!hole.contains((10, 20)));
            assert!(!hole.contains((22, 32)));
            assert!(!hole.contains((209, 119)));
            assert!(frame.contains_rect(*hole));
        }
        // A line inside the frame keeps its band clear too.
        let edged = super::holes(frame, 0.0, 1.0);
        assert_eq!(edged[0], rect(12, 22, 196, 96));
        // A frame too small for a hole has none.
        assert!(super::holes(rect(0, 0, 20, 20), 12.0, 1.0).is_empty());
    }

    #[test]
    fn bands_are_the_area_less_the_holes() {
        let area = rect(0, 0, 300, 200);
        let frame = rect(50, 40, 200, 100);
        let holes = holes(frame, 10.0, 0.0);
        let bands = bands(area, &holes);
        let drawn: i64 = bands.iter().map(|b| i64::from(b.size.w * b.size.h)).sum();
        let hidden: i64 = 178 * 98 + 198 * 78 - 178 * 78;
        assert_eq!(drawn, 300 * 200 - hidden);
        for band in &bands {
            assert!(area.contains_rect(*band));
            assert!(holes.iter().all(|hole| !hole.overlaps(*band)));
        }
    }
}
