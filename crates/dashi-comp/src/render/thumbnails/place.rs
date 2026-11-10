//! Where a window goes in a picture: fitted into its rect, or scaled with its screen.

use smithay::utils::{Logical, Point, Rectangle, Size};

/// Where a window's outer frame of `size` goes in a picture `rect`: as large
/// as fits, never larger than it is, centered.
pub(crate) fn fit(
    size: Size<i32, Logical>,
    rect: Rectangle<i32, Logical>,
) -> Rectangle<f64, Logical> {
    let (w, h) = (f64::from(size.w.max(1)), f64::from(size.h.max(1)));
    let by = (f64::from(rect.size.w) / w)
        .min(f64::from(rect.size.h) / h)
        .min(1.0);
    let (fw, fh) = (w * by, h * by);
    let loc = rect.loc.to_f64()
        + Point::from((
            (f64::from(rect.size.w) - fw) / 2.0,
            (f64::from(rect.size.h) - fh) / 2.0,
        ));
    Rectangle::new(loc, (fw, fh).into())
}

/// Where `frame`, on a screen at `screen`, is drawn in that screen's picture `rect`.
pub(crate) fn on_preview(
    screen: Rectangle<i32, Logical>,
    rect: Rectangle<i32, Logical>,
    frame: Rectangle<i32, Logical>,
) -> Rectangle<f64, Logical> {
    let by = f64::from(rect.size.w) / f64::from(screen.size.w.max(1));
    let at = (frame.loc - screen.loc).to_f64();
    Rectangle::new(
        rect.loc.to_f64() + Point::from((at.x * by, at.y * by)),
        (f64::from(frame.size.w) * by, f64::from(frame.size.h) * by).into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_fits_its_picture_centered_and_never_grows() {
        let picture = Rectangle::new((100, 100).into(), (200, 100).into());
        let wide = fit((1000, 400).into(), picture);
        assert_eq!(wide.size.w, 200.0);
        assert_eq!(wide.size.h, 80.0);
        assert_eq!(wide.loc.y, 110.0, "centered top to bottom");
        let small = fit((50, 20).into(), picture);
        assert_eq!((small.size.w, small.size.h), (50.0, 20.0));
        assert_eq!((small.loc.x, small.loc.y), (175.0, 140.0));
    }

    #[test]
    fn a_desktop_picture_is_its_screen_scaled() {
        let screen = Rectangle::new((1920, 0).into(), (1920, 1080).into());
        let picture = Rectangle::new((2000, 40).into(), (192, 108).into());
        let frame = Rectangle::new((2880, 540).into(), (960, 540).into());
        let drawn = on_preview(screen, picture, frame);
        assert_eq!((drawn.loc.x, drawn.loc.y), (2096.0, 94.0));
        assert_eq!((drawn.size.w, drawn.size.h), (96.0, 54.0));
    }
}
