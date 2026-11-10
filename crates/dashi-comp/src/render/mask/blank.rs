//! Painting the blank into a picture, and growing an area outward to whole pixels.

use smithay::utils::{Logical, Rectangle};

use crate::render::capture::Picture;

/// What a blanked area is painted: an opaque dark gray, plainly not content.
const BLANK: [u8; 4] = [38, 38, 42, 255];

/// `rect` grown out to whole logical pixels: never a sliver of what is under it.
pub(in crate::render) fn outward(rect: Rectangle<f64, Logical>) -> Rectangle<i32, Logical> {
    let (x0, y0) = (rect.loc.x.floor(), rect.loc.y.floor());
    let (x1, y1) = (
        (rect.loc.x + rect.size.w).ceil(),
        (rect.loc.y + rect.size.h).ceil(),
    );
    Rectangle::new(
        (x0 as i32, y0 as i32).into(),
        ((x1 - x0) as i32, (y1 - y0) as i32).into(),
    )
}

/// Paint `rects` (global logical) opaque in `picture`, which shows `area` at `scale`.
/// `None` blanks all of it.
pub(crate) fn blank(
    picture: &mut Picture,
    area: Rectangle<i32, Logical>,
    scale: f64,
    rects: Option<&[Rectangle<i32, Logical>]>,
) {
    let (width, height) = (
        picture.width.max(0) as usize,
        picture.height.max(0) as usize,
    );
    let mut fill = |x0: usize, y0: usize, x1: usize, y1: usize| {
        for y in y0..y1.min(height) {
            let row = y * width * 4;
            for x in x0..x1.min(width) {
                picture.rgba[row + x * 4..row + x * 4 + 4].copy_from_slice(&BLANK);
            }
        }
    };
    let Some(rects) = rects else {
        fill(0, 0, width, height);
        return;
    };
    for rect in rects {
        let Some(on) = rect.intersection(area) else {
            continue;
        };
        // Outward to whole pixels: never a sliver of what is under it.
        let left = (f64::from(on.loc.x - area.loc.x) * scale).floor().max(0.0) as usize;
        let top = (f64::from(on.loc.y - area.loc.y) * scale).floor().max(0.0) as usize;
        let right = (f64::from(on.loc.x - area.loc.x + on.size.w) * scale).ceil() as usize;
        let bottom = (f64::from(on.loc.y - area.loc.y + on.size.h) * scale).ceil() as usize;
        fill(left, top, right, bottom);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(w: i32, h: i32) -> Picture {
        Picture {
            width: w,
            height: h,
            rgba: vec![255; (w * h * 4) as usize],
        }
    }

    fn blanked(p: &Picture) -> Vec<(i32, i32)> {
        (0..p.height)
            .flat_map(|y| (0..p.width).map(move |x| (x, y)))
            .filter(|(x, y)| {
                let i = ((y * p.width + x) * 4) as usize;
                p.rgba[i..i + 4] == BLANK
            })
            .collect()
    }

    #[test]
    fn rects_are_blanked_where_they_are_in_the_picture() {
        let mut p = picture(10, 10);
        let area = Rectangle::new((100, 100).into(), (10, 10).into());
        let rect = Rectangle::new((102, 103).into(), (2, 1).into());
        blank(&mut p, area, 1.0, Some(&[rect]));
        assert_eq!(blanked(&p), vec![(2, 3), (3, 3)]);
    }

    #[test]
    fn scaled_pictures_are_blanked_outward_to_whole_pixels() {
        let mut p = picture(15, 15);
        let area = Rectangle::new((0, 0).into(), (10, 10).into());
        // 1.5×: logical 1..2 is pixels 1.5..3, so 1, 2 (outward).
        blank(
            &mut p,
            area,
            1.5,
            Some(&[Rectangle::new((1, 1).into(), (1, 1).into())]),
        );
        assert_eq!(blanked(&p), vec![(1, 1), (2, 1), (1, 2), (2, 2)]);
    }

    #[test]
    fn rects_off_the_picture_change_nothing_and_none_blanks_it_all() {
        let mut p = picture(4, 4);
        let area = Rectangle::new((0, 0).into(), (4, 4).into());
        blank(
            &mut p,
            area,
            1.0,
            Some(&[Rectangle::new((50, 50).into(), (5, 5).into())]),
        );
        assert!(blanked(&p).is_empty());
        // Partly on: clipped to the picture.
        blank(
            &mut p,
            area,
            1.0,
            Some(&[Rectangle::new((3, 3).into(), (5, 5).into())]),
        );
        assert_eq!(blanked(&p), vec![(3, 3)]);
        blank(&mut p, area, 1.0, None);
        assert_eq!(blanked(&p).len(), 16);
    }
}
