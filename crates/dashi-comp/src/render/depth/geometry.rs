//! The arithmetic of depth, free of any renderer: which shadow a window
//! casts, how far it reaches (the damage it can cause), the inside of the
//! frame that never needs drawing, and the focus cross-fade.

use std::time::{Duration, Instant};

use smithay::utils::{Physical, Rectangle};

use super::style::{Layer, Shadow, Style};

/// How far a Gaussian of sigma blur/2 is still seen: three sigmas.
const BLUR_REACH: f64 = 1.5;

/// What a window is, for its depth.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    /// Full screen, or a client that draws its own shadow: nothing.
    Bare,
    /// Placed by hand: the focused or the other shadow, cross-faded.
    Free,
    /// Framed with `tiled` (a tile).
    Tiled,
    /// Framed with `maximized` (Fill).
    Filled,
    /// Attached to another window (`attach`).
    Sheet,
}

/// The facts a window's role follows from.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct Facts {
    pub fullscreen: bool,
    /// Its surfaces reach past its geometry: the client draws its own shadow.
    pub own_shadow: bool,
    pub sheet: bool,
    /// The shell framed it as a tile (`frame {tiled}`).
    pub tiled: bool,
    /// The shell's Fill (`frame {maximized}`).
    pub filled: bool,
}

pub(crate) fn role(facts: Facts) -> Role {
    if facts.fullscreen || facts.own_shadow {
        Role::Bare
    } else if facts.sheet {
        Role::Sheet
    } else if facts.filled {
        Role::Filled
    } else if facts.tiled {
        Role::Tiled
    } else {
        Role::Free
    }
}

/// The shadow a window of `role` casts, `focus` of the way from the other
/// shadow to the focused one (0: unfocused, 1: focused).
pub(crate) fn shadow_for(style: &Style, role: Role, focus: f64) -> Shadow {
    match role {
        Role::Bare => Shadow::default(),
        Role::Free => mix(&style.other, &style.focused, focus),
        Role::Tiled => style.tiled,
        Role::Filled => style.filled,
        Role::Sheet => style.sheet,
    }
}

/// Every number of `a` moved `t` of the way to `b`'s.
pub(crate) fn mix(a: &Shadow, b: &Shadow, t: f64) -> Shadow {
    let t = t.clamp(0.0, 1.0);
    let m = |x: f64, y: f64| x + (y - x) * t;
    let layer = |a: &Layer, b: &Layer| Layer {
        x: m(a.x, b.x),
        y: m(a.y, b.y),
        blur: m(a.blur, b.blur),
        spread: m(a.spread, b.spread),
        alpha: m(a.alpha, b.alpha),
    };
    [layer(&a[0], &b[0]), layer(&a[1], &b[1])]
}

/// The shadow drawn `s` times its size (a window drawn small).
pub(crate) fn scaled(shadow: &Shadow, s: f64) -> Shadow {
    shadow.map(|layer| Layer {
        x: layer.x * s,
        y: layer.y * s,
        blur: layer.blur * s,
        spread: layer.spread * s,
        alpha: layer.alpha,
    })
}

pub(crate) fn casts(shadow: &Shadow) -> bool {
    shadow.iter().any(|layer| layer.alpha > 0.0)
}

/// Everything a window's shadow and `ring` can touch around `frame`, with a
/// pixel to spare for antialiasing: the area its back element covers.
pub(crate) fn extent<K>(frame: Rectangle<f64, K>, shadow: &Shadow, ring: f64) -> Rectangle<f64, K> {
    let grow = |rect: Rectangle<f64, K>, by: f64| {
        let by = by.max(0.0);
        Rectangle::new(
            (rect.loc.x - by, rect.loc.y - by).into(),
            (rect.size.w + 2.0 * by, rect.size.h + 2.0 * by).into(),
        )
    };
    shadow
        .iter()
        .filter(|layer| layer.alpha > 0.0)
        .map(|layer| {
            let mut cast = frame;
            cast.loc.x += layer.x;
            cast.loc.y += layer.y;
            grow(cast, layer.spread + layer.blur * BLUR_REACH + 1.0)
        })
        .fold(grow(frame, ring + 1.0), |all, cast| all.merge(cast))
}

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

/// A window's focus as drawn: moving from `from` to `to` (0 unfocused, 1
/// focused) since `since`, eased over the style's fade.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Focus {
    from: f64,
    to: f64,
    since: Instant,
}

impl Focus {
    pub(crate) fn settled(focused: bool, now: Instant) -> Self {
        let at = if focused { 1.0 } else { 0.0 };
        Self {
            from: at,
            to: at,
            since: now,
        }
    }

    pub(crate) fn value(&self, now: Instant, length: Duration) -> f64 {
        let e = fade(now.saturating_duration_since(self.since), length);
        self.from + (self.to - self.from) * e
    }

    /// Focus is now `focused`: a change starts from where the last one is.
    pub(crate) fn follow(&mut self, focused: bool, now: Instant, length: Duration) {
        let to = if focused { 1.0 } else { 0.0 };
        if to != self.to {
            self.from = self.value(now, length);
            self.to = to;
            self.since = now;
        }
    }
}

/// How far a focus change has come, eased (ease-out cubic) from 0 to 1.
pub(crate) fn fade(elapsed: Duration, length: Duration) -> f64 {
    if length.is_zero() {
        return 1.0;
    }
    let t = (elapsed.as_secs_f64() / length.as_secs_f64()).clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use smithay::utils::Logical;

    fn layer(y: f64, blur: f64, spread: f64, alpha: f64) -> Layer {
        Layer {
            x: 0.0,
            y,
            blur,
            spread,
            alpha,
        }
    }

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    #[test]
    fn roles() {
        let free = Facts::default();
        assert_eq!(role(free), Role::Free);
        assert_eq!(
            role(Facts {
                tiled: true,
                ..free
            }),
            Role::Tiled
        );
        // Fill wins over a tile.
        let filled = Facts {
            tiled: true,
            filled: true,
            ..free
        };
        assert_eq!(role(filled), Role::Filled);
        assert_eq!(
            role(Facts {
                fullscreen: true,
                ..filled
            }),
            Role::Bare
        );
        assert_eq!(
            role(Facts {
                own_shadow: true,
                ..free
            }),
            Role::Bare
        );
        assert_eq!(
            role(Facts {
                sheet: true,
                tiled: true,
                ..free
            }),
            Role::Sheet
        );
    }

    #[test]
    fn the_shadow_follows_focus_and_role() {
        let style = Style {
            focused: [layer(18.0, 40.0, -8.0, 0.4), layer(2.0, 6.0, 0.0, 0.2)],
            other: [layer(8.0, 20.0, -6.0, 0.2), Layer::default()],
            tiled: [layer(0.0, 8.0, 0.0, 0.2), Layer::default()],
            ..Style::default()
        };
        assert_eq!(shadow_for(&style, Role::Free, 1.0), style.focused);
        assert_eq!(shadow_for(&style, Role::Free, 0.0), style.other);
        let half = shadow_for(&style, Role::Free, 0.5);
        assert!((half[0].y - 13.0).abs() < 1e-9);
        assert!((half[1].alpha - 0.1).abs() < 1e-9);
        assert_eq!(shadow_for(&style, Role::Tiled, 1.0), style.tiled);
        assert!(!casts(&shadow_for(&style, Role::Filled, 1.0)));
        assert!(!casts(&shadow_for(&style, Role::Bare, 1.0)));
    }

    #[test]
    fn extent_reaches_as_far_as_the_blur() {
        let frame: Rectangle<f64, Logical> =
            Rectangle::new((100.0, 100.0).into(), (400.0, 300.0).into());
        // Only the ring's pixel: no shadow.
        let none = extent(frame, &Shadow::default(), 0.0);
        assert_eq!(
            none,
            Rectangle::new((99.0, 99.0).into(), (402.0, 302.0).into())
        );
        // 0 18 40 -8: 60 out (three sigmas), less 8, plus a pixel; 18 lower.
        let shadow = [layer(18.0, 40.0, -8.0, 0.4), Layer::default()];
        let cast = extent(frame, &shadow, 0.0);
        assert_eq!(cast.loc.x, 100.0 - 53.0);
        assert_eq!(cast.loc.y, 100.0 + 18.0 - 53.0);
        assert_eq!(cast.size.w, 400.0 + 106.0);
        assert_eq!(cast.loc.y + cast.size.h, 100.0 + 300.0 + 18.0 + 53.0);
        // A layer with no alpha reaches nothing.
        let faint = [layer(18.0, 40.0, -8.0, 0.0), Layer::default()];
        assert_eq!(extent(frame, &faint, 0.0), none);
        // The ring goes out by its width.
        let ring = extent(frame, &Shadow::default(), 1.5);
        assert_eq!(ring.loc.x, 97.5);
    }

    #[test]
    fn scaled_shadows_shrink_with_the_window() {
        let shadow = [layer(18.0, 40.0, -8.0, 0.4), Layer::default()];
        let small = scaled(&shadow, 0.25);
        assert_eq!(small[0].y, 4.5);
        assert_eq!(small[0].blur, 10.0);
        assert_eq!(small[0].spread, -2.0);
        assert_eq!(small[0].alpha, 0.4);
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

    #[test]
    fn focus_cross_fades_from_where_it_is() {
        let length = Duration::from_millis(150);
        let start = Instant::now();
        let mut focus = Focus::settled(false, start);
        assert_eq!(focus.value(start, length), 0.0);
        focus.follow(true, start, length);
        assert_eq!(focus.value(start, length), 0.0);
        assert_eq!(focus.value(start + length, length), 1.0);
        // Focus goes back halfway: it fades down from where it got to, no jump.
        let midway = start + Duration::from_millis(50);
        let reached = focus.value(midway, length);
        focus.follow(false, midway, length);
        assert_eq!(focus.value(midway, length), reached);
        assert_eq!(focus.value(midway + length, length), 0.0);
        // The same focus again changes nothing.
        let later = midway + length;
        focus.follow(false, later, length);
        assert_eq!(focus.value(later, length), 0.0);
        // Without a fade (Reduce Motion), it is there at once.
        focus.follow(true, later, Duration::ZERO);
        assert_eq!(focus.value(later, Duration::ZERO), 1.0);
    }

    #[test]
    fn fades_ease_out() {
        let length = Duration::from_millis(150);
        assert_eq!(fade(Duration::ZERO, length), 0.0);
        assert_eq!(fade(length, length), 1.0);
        assert_eq!(fade(Duration::from_secs(5), length), 1.0);
        assert!(fade(Duration::from_millis(75), length) > 0.5);
        assert_eq!(fade(Duration::ZERO, Duration::ZERO), 1.0);
    }
}
