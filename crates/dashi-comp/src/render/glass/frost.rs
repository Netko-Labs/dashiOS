//! Frosting: once a screen's elements are all known, each pane of glass gets
//! a blurred picture of what is behind it. Back to front, so glass over glass
//! sees the lower pane frosted.
//!
//! For each pane, what is behind it (the elements after it in the list) is
//! drawn at half size into a texture of its own, the pane plus the blur's
//! reach (clipped to the screen), by a damage tracker of its own: when
//! nothing behind changed, nothing is drawn and the last blur is kept, and
//! the pane is not damaged on screen. Only when something did is it blurred
//! again (kawase.rs). The textures live with the GPU's EGL context.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            Bind, ImportAll, ImportMem, Offscreen, Renderer, Texture,
            damage::OutputDamageTracker,
            element::{
                Id,
                utils::{Relocate, RelocateRenderElement, RescaleRenderElement},
            },
            gles::{GlesRenderer, GlesTexture},
            utils::CommitCounter,
        },
    },
    utils::{Buffer, Physical, Point, Rectangle, Size, Transform},
};

use super::{
    element::{Frosted, GlassElement, PaneKey},
    kawase::{self, Pyramid},
    params::Look,
    shaders::{self, Programs},
};
use crate::render::{DashiElement, GlesAccess};

/// Calls without a pane before its textures are let go.
const FORGET_AFTER: u64 = 600;
/// A backdrop's size is a whole number of these, in the screen's pixels.
const BUCKET: i32 = 64;

/// One pane's textures and trackers, kept from frame to frame.
struct Cache {
    id: Id,
    commit: CommitCounter,
    backdrop: GlesTexture,
    tracker: OutputDamageTracker,
    pyramid: Pyramid,
    sigma: f64,
    look: Option<Look>,
    /// Blurred at least once.
    blurred: bool,
    used: u64,
}

#[derive(Default)]
struct Caches {
    panes: HashMap<(String, PaneKey), Cache>,
    turn: u64,
}

struct Kept(Rc<RefCell<Caches>>);

fn caches(gles: &mut GlesRenderer) -> Rc<RefCell<Caches>> {
    let data = gles.egl_context().user_data();
    data.insert_if_missing(|| Kept(Rc::default()));
    data.get::<Kept>()
        .map_or_else(Rc::default, |kept| kept.0.clone())
}

/// What one frosting did: how many panes, how many were blurred again.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Frosting {
    pub panes: u32,
    pub blurred: u32,
}

/// Frost every pane in `elements`, a screen's (`screen`, in its pixels, at `scale`).
pub(crate) fn frost<R>(
    renderer: &mut R,
    output: &str,
    screen: Size<i32, Physical>,
    scale: f64,
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
    let caches = caches(renderer.gles());
    let mut caches = caches.borrow_mut();
    caches.turn += 1;
    let turn = caches.turn;
    for at in (0..elements.len()).rev() {
        let (front, behind) = elements.split_at_mut(at + 1);
        let DashiElement::Glass(glass) = &mut front[at] else {
            continue;
        };
        let key = (output.to_owned(), glass.key.clone());
        let place = Place {
            screen: Rectangle::from_size(screen),
            scale,
            turn,
        };
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
        done.blurred += u32::from(frosted.as_ref().is_some_and(|(_, again)| *again));
        glass.frosted = frosted.map(|(frosted, _)| frosted);
    }
    let old: Vec<_> = caches
        .panes
        .iter()
        .filter(|(_, cache)| turn - cache.used >= FORGET_AFTER)
        .map(|(key, _)| key.clone())
        .collect();
    for key in old {
        if let Some(cache) = caches.panes.remove(&key) {
            cache.pyramid.free(renderer.gles());
        }
    }
    Ok(done)
}

struct Place {
    screen: Rectangle<i32, Physical>,
    scale: f64,
    turn: u64,
}

/// New textures for a pane, keeping its id and commit.
fn fresh(
    gles: &mut GlesRenderer,
    id: Id,
    commit: CommitCounter,
    size: Size<i32, Buffer>,
    passes: usize,
    sigma: f64,
    place: &Place,
) -> Result<Cache, String> {
    Ok(Cache {
        id,
        commit,
        backdrop: gles.create_buffer(Fourcc::Abgr8888, size).map_err(text)?,
        tracker: OutputDamageTracker::new((size.w, size.h), place.scale, Transform::Normal),
        pyramid: Pyramid::new(gles, size, passes).map_err(text)?,
        sigma,
        look: None,
        blurred: false,
        used: place.turn,
    })
}

/// An error as text, for the log.
fn text(error: impl std::fmt::Debug) -> String {
    format!("{error:?}")
}

/// Frost one pane from what is `behind` it; with whether it was blurred again.
fn pane<R>(
    renderer: &mut R,
    programs: &Programs,
    panes: &mut HashMap<(String, PaneKey), Cache>,
    key: (String, PaneKey),
    glass: &GlassElement,
    behind: &[DashiElement<R>],
    place: &Place,
) -> Result<Option<(Frosted, bool)>, String>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let Some(shown) = glass.geometry.intersection(place.screen) else {
        return Ok(None);
    };
    let sigma = glass.look.blur;
    let reach = kawase::reach(sigma);
    // Grown to whole buckets, so a pane that grows a little (an entrance, a list getting
    // longer) keeps its textures.
    let bucket = |n: i32| (n + BUCKET - 1) / BUCKET * BUCKET;
    let wide = Rectangle::new(
        shown.loc - Point::from((reach, reach)),
        (
            bucket(shown.size.w + 2 * reach),
            bucket(shown.size.h + 2 * reach),
        )
            .into(),
    );
    let Some(area) = wide.intersection(place.screen) else {
        return Ok(None);
    };
    let size: Size<i32, Buffer> = ((area.size.w + 1) / 2, (area.size.h + 1) / 2).into();
    let (passes, spread) = kawase::plan(sigma);
    let stale = panes.get(&key).is_none_or(|cache| {
        cache.backdrop.size() != size || cache.pyramid.passes() != passes || cache.sigma != sigma
    });
    if stale {
        let gles = renderer.gles();
        if let Some(old) = panes.remove(&key) {
            old.pyramid.free(gles);
            let cache = fresh(gles, old.id, old.commit, size, passes, sigma, place)?;
            panes.insert(key.clone(), cache);
        } else {
            let cache = fresh(
                gles,
                Id::new(),
                CommitCounter::default(),
                size,
                passes,
                sigma,
                place,
            )?;
            panes.insert(key.clone(), cache);
        }
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
        // A line a pixel thick is nothing at half size, and smithay damages it (empty) every frame.
        let damage = drawn
            .damage
            .filter(|damage| damage.iter().any(|rect| !rect.is_empty()));
        if let Some(damage) = damage {
            tracing::debug!(target: "glass", pane = ?key.1, ?damage, behind = moved.len(), "what is behind changed");
        }
        damage.is_some()
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
    // The pane's part of the picture, at half size.
    let (x, y) = (
        f64::from(glass.geometry.loc.x - area.loc.x) / 2.0,
        f64::from(glass.geometry.loc.y - area.loc.y) / 2.0,
    );
    let (w, h) = (
        f64::from(glass.geometry.size.w) / 2.0,
        f64::from(glass.geometry.size.h) / 2.0,
    );
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
    )))
}
