//! The arithmetic of depth, free of any renderer: which shadow a window
//! casts, how far it reaches (the damage it can cause), the inside of the
//! frame that never needs drawing, and the focus cross-fade.

mod focus;
mod pixels;

use smithay::utils::{Physical, Rectangle};

pub(crate) use focus::{Focus, fade};
pub(crate) use pixels::{bands, holes, outward};

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

#[cfg(test)]
mod tests {
    use smithay::utils::Logical;

    use super::*;

    fn layer(y: f64, blur: f64, spread: f64, alpha: f64) -> Layer {
        Layer {
            x: 0.0,
            y,
            blur,
            spread,
            alpha,
        }
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
}
