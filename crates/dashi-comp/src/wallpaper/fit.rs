//! How a picture or video meets a screen: `fill` covers it (cropping the
//! overflow), `fit` shows all of it (bands beside or above), `center` shows it
//! at its own size in the middle (cropped where larger).

/// A rectangle in floating point: (x, y, width, height).
pub(crate) type Area = (f64, f64, f64, f64);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Mode {
    #[default]
    Fill,
    Fit,
    Center,
}

impl Mode {
    pub(crate) fn parse(name: &str) -> Option<Self> {
        match name {
            "fill" => Some(Mode::Fill),
            "fit" => Some(Mode::Fit),
            "center" => Some(Mode::Center),
            _ => None,
        }
    }
}

/// The part of the source to show (in source pixels) and where it lands on
/// the screen (in screen logical pixels, from the screen's origin).
pub(crate) fn place(
    mode: Mode,
    source: (f64, f64),
    screen: (f64, f64),
    scale: f64,
) -> (Area, Area) {
    let (sw, sh) = source;
    let (w, h) = screen;
    if sw <= 0.0 || sh <= 0.0 || w <= 0.0 || h <= 0.0 {
        return ((0.0, 0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 0.0));
    }
    match mode {
        Mode::Fill => {
            // The source's largest part with the screen's shape, centered.
            let ratio = (sw / w).min(sh / h);
            let (cw, ch) = (w * ratio, h * ratio);
            (((sw - cw) / 2.0, (sh - ch) / 2.0, cw, ch), (0.0, 0.0, w, h))
        }
        Mode::Fit => {
            let ratio = (w / sw).min(h / sh);
            let (dw, dh) = (sw * ratio, sh * ratio);
            ((0.0, 0.0, sw, sh), ((w - dw) / 2.0, (h - dh) / 2.0, dw, dh))
        }
        Mode::Center => {
            // One source pixel per screen pixel: logical size is the source over the scale.
            let (lw, lh) = (sw / scale.max(0.1), sh / scale.max(0.1));
            let (vw, vh) = (lw.min(w), lh.min(h));
            let src = (
                (lw - vw) / 2.0 * scale,
                (lh - vh) / 2.0 * scale,
                vw * scale,
                vh * scale,
            );
            (src, ((w - vw) / 2.0, (h - vh) / 2.0, vw, vh))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_crops_the_overflow_and_covers_the_screen() {
        // A square photo on a wide screen: the middle band of it, all of the screen.
        let (src, dst) = place(Mode::Fill, (1000.0, 1000.0), (1600.0, 900.0), 1.0);
        assert_eq!(dst, (0.0, 0.0, 1600.0, 900.0));
        assert_eq!(src, (0.0, 218.75, 1000.0, 562.5));
    }

    #[test]
    fn fit_shows_everything_between_bands() {
        let (src, dst) = place(Mode::Fit, (1000.0, 1000.0), (1600.0, 900.0), 1.0);
        assert_eq!(src, (0.0, 0.0, 1000.0, 1000.0));
        assert_eq!(dst, (350.0, 0.0, 900.0, 900.0));
    }

    #[test]
    fn center_keeps_pixels_one_to_one() {
        let (src, dst) = place(Mode::Center, (800.0, 600.0), (1600.0, 900.0), 1.0);
        assert_eq!(
            (src, dst),
            ((0.0, 0.0, 800.0, 600.0), (400.0, 150.0, 800.0, 600.0))
        );
        // At scale 2 the same picture is half as big on screen.
        let (_, dst) = place(Mode::Center, (800.0, 600.0), (1600.0, 900.0), 2.0);
        assert_eq!(dst, (600.0, 300.0, 400.0, 300.0));
        // Larger than the screen: its middle.
        let (src, dst) = place(Mode::Center, (4000.0, 3000.0), (1600.0, 900.0), 1.0);
        assert_eq!(
            (src, dst),
            ((1200.0, 1050.0, 1600.0, 900.0), (0.0, 0.0, 1600.0, 900.0))
        );
    }

    #[test]
    fn modes_by_name() {
        assert_eq!(Mode::parse("fit"), Some(Mode::Fit));
        assert_eq!(Mode::parse("tile"), None);
    }
}
