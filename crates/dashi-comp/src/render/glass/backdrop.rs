//! A pane's backdrop: how much of the screen is drawn behind it (the pane
//! and its hairline, plus the blur's reach, grown to whole buckets so a pane
//! that grows a little keeps its textures, clipped to the screen), drawing it
//! and blurring it when it changed, and how deep under other glass it is.

use std::collections::HashMap;

use smithay::{
    backend::renderer::{
        Bind, ImportAll, ImportMem, Offscreen, Renderer, Texture,
        element::utils::{Relocate, RelocateRenderElement, RescaleRenderElement},
        gles::GlesTexture,
    },
    utils::{Buffer, Physical, Point, Rectangle, Size},
};

use super::{
    cache::{Cache, text},
    element::PaneKey,
    frost::Place,
    kawase,
    shaders::Programs,
    style::Look,
    tone,
};
use crate::render::{DashiElement, GlesAccess};

/// A backdrop's size is a whole number of these, in the screen's pixels.
const BUCKET: i32 = 64;

/// What is drawn behind a pane showing at `shown` (on the screen), for a blur of `sigma`
/// pixels: none when nothing of it is on `screen`. Never empty.
pub(super) fn area(
    shown: Rectangle<i32, Physical>,
    sigma: f64,
    screen: Rectangle<i32, Physical>,
) -> Option<Rectangle<i32, Physical>> {
    let reach = kawase::reach(sigma);
    let bucket = |n: i32| (n + BUCKET - 1) / BUCKET * BUCKET;
    let wide = Rectangle::new(
        shown.loc - Point::from((reach, reach)),
        (
            bucket(shown.size.w + 2 * reach),
            bucket(shown.size.h + 2 * reach),
        )
            .into(),
    );
    wide.intersection(screen).filter(|area| !area.is_empty())
}

/// Whether a backdrop's tracker drew anything: a line a pixel thick is nothing at half size,
/// and smithay damages it as an empty rectangle every frame, which is no change.
pub(super) fn changed(damage: Option<&Vec<Rectangle<i32, Physical>>>) -> bool {
    damage.is_some_and(|damage| damage.iter().any(|rect| !rect.is_empty()))
}

/// How many layers of glass are under a pane at `rect`, of those already frosted (each with
/// its own depth, counting itself).
pub(super) fn layers(
    below: &[(Rectangle<i32, Physical>, usize)],
    rect: Rectangle<i32, Physical>,
) -> usize {
    below
        .iter()
        .filter(|(under, _)| under.overlaps(rect))
        .map(|(_, depth)| *depth)
        .max()
        .unwrap_or(0)
}

/// Draw what is `behind` into `key`'s backdrop over `area` (half size), and blur it when it
/// changed; whether it was blurred again, and the backdrop's tone when one was read.
#[expect(
    clippy::too_many_arguments,
    reason = "the frosting's parts, passed as frost() holds them: the caches are borrowed apart"
)]
pub(super) fn blur_behind<R>(
    renderer: &mut R,
    programs: &Programs,
    panes: &mut HashMap<(String, PaneKey), Cache>,
    key: &(String, PaneKey),
    area: Rectangle<i32, Physical>,
    look: Look,
    behind: &[DashiElement<R>],
    place: &Place,
) -> Result<(bool, Option<[u8; 3]>), String>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let sigma = look.blur;
    let size: Size<i32, Buffer> = ((area.size.w + 1) / 2, (area.size.h + 1) / 2).into();
    let (passes, spread) = kawase::plan(sigma);
    let stale = panes.get(key).is_none_or(|cache| {
        cache.backdrop.size() != size || cache.pyramid.passes() != passes || cache.sigma != sigma
    });
    if stale {
        let gles = renderer.gles();
        if let Some(old) = panes.remove(key) {
            old.pyramid.free(gles);
        }
        let fresh = super::cache::fresh(gles, size, passes, sigma, (place.scale, place.turn))?;
        panes.insert(key.clone(), fresh);
    }
    let Some(cache) = panes.get_mut(key) else {
        return Ok((false, None));
    };
    cache.used = place.turn;
    // X-ray glass sees only the wallpaper: the last element, when it is one.
    let behind = match behind.last() {
        Some(last @ DashiElement::Memory(_)) if look.xray => std::slice::from_ref(last),
        _ => behind,
    };
    let moved: Vec<_> = behind
        .iter()
        .map(|element| {
            RelocateRenderElement::from_element(
                RescaleRenderElement::from_element(element, area.loc, 0.5),
                Point::from((-area.loc.x, -area.loc.y)),
                Relocate::Relative,
            )
        })
        .collect();
    let changed = {
        let mut target = renderer.bind(&mut cache.backdrop).map_err(text)?;
        let drawn = cache
            .tracker
            .render_output(renderer, &mut target, 1, &moved, [0.0, 0.0, 0.0, 1.0])
            .map_err(text)?;
        let changed = changed(drawn.damage);
        if changed {
            tracing::debug!(target: "glass", pane = ?key.1, behind = moved.len(), "what is behind changed");
        }
        changed
    };
    let again = changed || !cache.blurred;
    if again {
        cache
            .pyramid
            .blur(renderer.gles(), programs, &cache.backdrop, spread)
            .map_err(text)?;
        cache.blurred = true;
    }
    let tone = cache
        .tone
        .wants(again, place.now)
        .then(|| cache.pyramid.mean(renderer.gles()))
        .flatten()
        .and_then(|mean| {
            cache
                .tone
                .read(tone::lifted(mean, look.saturation, look.brightness))
        });
    Ok((again, tone))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, w: i32, h: i32) -> Rectangle<i32, Physical> {
        Rectangle::new((x, y).into(), (w, h).into())
    }

    #[test]
    fn a_backdrop_reaches_past_the_pane_in_whole_buckets_on_the_screen() {
        let screen = rect(0, 0, 1920, 1200);
        let area = area(rect(400, 300, 600, 400), 30.0, screen).unwrap();
        let reach = kawase::reach(30.0);
        assert_eq!(area.loc, (400 - reach, 300 - reach).into());
        assert_eq!(area.size.w % BUCKET, 0);
        assert_eq!(area.size.h % BUCKET, 0);
        assert!(area.size.w >= 600 + 2 * reach);
        // A pane a few pixels taller keeps the same backdrop (its textures are kept).
        assert_eq!(
            super::area(rect(400, 300, 600, 404), 30.0, screen)
                .unwrap()
                .size,
            area.size
        );
        // At the screen's edge it is clipped; off it, or empty, there is none.
        let corner = super::area(rect(0, 0, 100, 30), 30.0, screen).unwrap();
        assert_eq!(corner.loc, (0, 0).into());
        assert_eq!(super::area(rect(3000, 0, 100, 30), 30.0, screen), None);
        assert!(super::area(rect(0, 0, 0, 0), 0.0, screen).is_none());
    }

    #[test]
    fn empty_damage_is_no_change() {
        assert!(!changed(None));
        assert!(!changed(Some(&Vec::new())));
        // What smithay reports for a 1 px line at half size, every frame.
        assert!(!changed(Some(&vec![rect(10, 10, 0, 1), rect(3, 4, 5, 0)])));
        assert!(changed(Some(&vec![rect(10, 10, 0, 1), rect(3, 4, 5, 1)])));
    }

    #[test]
    fn depth_counts_only_the_glass_under_a_pane() {
        let control_center = (rect(1000, 30, 400, 600), 1);
        let menu = (rect(1100, 100, 200, 300), 2);
        let bar = (rect(0, 0, 1920, 30), 1);
        let below = [bar, control_center, menu];
        // A submenu over the menu over Control Center: two layers under it.
        assert_eq!(layers(&below, rect(1250, 150, 150, 100)), 2);
        // A banner over the bar only: one.
        assert_eq!(layers(&below, rect(10, 5, 200, 20)), 1);
        // Touching is not overlapping: the menu's top edge on the bar's bottom.
        assert_eq!(layers(&below[..1], rect(0, 30, 100, 100)), 0);
    }
}
