//! Frosting: once a screen's elements are all known, each pane of glass gets
//! a blurred picture of what is behind it. Back to front, so glass over glass
//! sees the lower pane frosted; a pane under more glass than the style allows
//! is drawn as its solid twin instead (GL-2), as is every pane in solid mode.
//!
//! For each pane, what is behind it (the elements after it in the list) is
//! drawn at half size into a texture of its own, the pane and its hairline
//! plus the blur's reach (clipped to the screen), by a damage tracker of its
//! own: when nothing behind changed, nothing is drawn and the last blur is
//! kept, and the pane is not damaged on screen. Only when something did is it
//! blurred again (kawase.rs). The textures live with the GPU's EGL context
//! (cache.rs).

use std::{collections::HashMap, time::Instant};

use smithay::{
    backend::renderer::{
        Bind, ImportAll, ImportMem, Offscreen, Renderer, Texture,
        element::{
            Id,
            utils::{Relocate, RelocateRenderElement, RescaleRenderElement},
        },
        gles::GlesTexture,
        utils::CommitCounter,
    },
    utils::{Buffer, Physical, Point, Rectangle, Size},
};

use super::{
    backdrop,
    cache::{self, Cache, text},
    element::{Frosted, GlassElement, PaneKey},
    kawase,
    shaders::{self, Programs},
    style::Style,
    tone,
};
use crate::render::{DashiElement, GlesAccess};

/// Calls without a pane before its textures are let go.
const FORGET_AFTER: u64 = 600;

/// What one frosting did: how many panes, how many were blurred again, and the tones read.
#[derive(Debug, Default, Clone)]
pub(crate) struct Frosting {
    pub panes: u32,
    pub blurred: u32,
    pub tones: Vec<(PaneKey, [u8; 3])>,
}

/// Frost every pane in `elements`, a screen's (`screen`, in its pixels, at `scale`); a pane
/// under more than `deepest` layers of glass is drawn solid (none: as deep as last time).
pub(crate) fn frost<R>(
    renderer: &mut R,
    output: &str,
    screen: Size<i32, Physical>,
    (scale, deepest): (f64, Option<usize>),
    elements: &mut [DashiElement<R>],
) -> Result<Frosting, String>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let mut done = Frosting::default();
    if !elements.iter().any(|e| matches!(e, DashiElement::Glass(_))) {
        return Ok(done);
    }
    let programs = shaders::programs(renderer.gles()).ok_or("the glass shaders did not compile")?;
    let caches = cache::caches(renderer.gles());
    let mut caches = caches.borrow_mut();
    caches.turn += 1;
    let deepest = deepest.unwrap_or(caches.deepest);
    caches.deepest = deepest;
    let place = Place {
        screen: Rectangle::from_size(screen),
        scale,
        turn: caches.turn,
        now: Instant::now(),
    };
    let mut below: Vec<(Rectangle<i32, Physical>, usize)> = Vec::new();
    for at in (0..elements.len()).rev() {
        let (front, behind) = elements.split_at_mut(at + 1);
        let DashiElement::Glass(glass) = &mut front[at] else {
            continue;
        };
        let depth = backdrop::layers(&below, glass.geometry) + 1;
        below.push((glass.geometry, depth));
        if depth > deepest
            && let Some(look) = Style::solid_twin(glass.look, glass.twin)
        {
            glass.look = look;
        }
        let key = (output.to_owned(), glass.key.clone());
        if glass.look.solid.is_some() {
            let solid = cache::solid(renderer.gles(), &programs, &mut caches, key, glass, &place)?;
            glass.frosted = Some(solid);
            done.panes += 1;
            continue;
        }
        let frosted = pane(
            renderer,
            &programs,
            &mut caches.panes,
            key,
            glass,
            behind,
            &place,
        )?;
        done.panes += u32::from(frosted.is_some());
        if let Some((_, again, tone)) = &frosted {
            done.blurred += u32::from(*again);
            done.tones
                .extend(tone.map(|tone| (glass.key.clone(), tone)));
        }
        glass.frosted = frosted.map(|(frosted, _, _)| frosted);
    }
    cache::forget(renderer.gles(), &mut caches, FORGET_AFTER);
    Ok(done)
}

/// A pane frosted, whether it was blurred again, and its tone if one was read.
type PaneDone = (Frosted, bool, Option<[u8; 3]>);

/// Where the panes of one frosting are: the screen, its scale, the turn, the time.
pub(super) struct Place {
    pub screen: Rectangle<i32, Physical>,
    pub scale: f64,
    pub turn: u64,
    pub now: Instant,
}

/// Frost one pane from what is `behind` it; with whether it was blurred again, and its
/// backdrop's tone when one was read.
fn pane<R>(
    renderer: &mut R,
    programs: &Programs,
    panes: &mut HashMap<(String, PaneKey), Cache>,
    key: (String, PaneKey),
    glass: &GlassElement,
    behind: &[DashiElement<R>],
    place: &Place,
) -> Result<Option<PaneDone>, String>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let outer = glass.outer();
    let Some(shown) = outer.intersection(place.screen).filter(|r| !r.is_empty()) else {
        return Ok(None);
    };
    let sigma = glass.look.blur;
    let Some(area) = backdrop::area(shown, sigma, place.screen) else {
        return Ok(None);
    };
    let size: Size<i32, Buffer> = ((area.size.w + 1) / 2, (area.size.h + 1) / 2).into();
    let (passes, spread) = kawase::plan(sigma);
    let stale = panes.get(&key).is_none_or(|cache| {
        cache.backdrop.size() != size || cache.pyramid.passes() != passes || cache.sigma != sigma
    });
    if stale {
        let gles = renderer.gles();
        let at = (place.scale, place.turn);
        let cache = match panes.remove(&key) {
            Some(old) => {
                old.pyramid.free(gles);
                cache::fresh(gles, old.id, old.commit, size, passes, sigma, at)?
            }
            None => cache::fresh(
                gles,
                Id::new(),
                CommitCounter::default(),
                size,
                passes,
                sigma,
                at,
            )?,
        };
        panes.insert(key.clone(), cache);
    }
    let Some(cache) = panes.get_mut(&key) else {
        return Ok(None);
    };
    cache.used = place.turn;
    // X-ray glass sees only the wallpaper: the last element, when it is one.
    let behind = match behind.last() {
        Some(last @ DashiElement::Memory(_)) if glass.look.xray => std::slice::from_ref(last),
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
        let changed = backdrop::changed(drawn.damage);
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
    if again || cache.look != Some(glass.look) {
        cache.commit.increment();
        cache.look = Some(glass.look);
    }
    let tone = cache
        .tone
        .wants(again, place.now)
        .then(|| cache.pyramid.mean(renderer.gles()))
        .flatten()
        .and_then(|mean| {
            let look = glass.look;
            cache
                .tone
                .read(tone::lifted(mean, look.saturation, look.brightness))
        });
    // The pane's part of the picture (and its hairline's), at half size.
    let (x, y) = (
        f64::from(outer.loc.x - area.loc.x) / 2.0,
        f64::from(outer.loc.y - area.loc.y) / 2.0,
    );
    let (w, h) = (f64::from(outer.size.w) / 2.0, f64::from(outer.size.h) / 2.0);
    let src = Rectangle::new((x, y).into(), (w, h).into());
    Ok(Some((
        Frosted {
            id: cache.id.clone(),
            commit: cache.commit,
            texture: cache.pyramid.out.clone(),
            src,
            program: programs.pane.clone(),
        },
        again,
        tone,
    )))
}
