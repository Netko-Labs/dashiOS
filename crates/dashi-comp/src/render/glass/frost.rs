//! Frosting: once a screen's elements are all known, each pane of glass gets
//! a blurred picture of what is behind it. Back to front, so glass over glass
//! sees the lower pane frosted; a pane under more glass than the style allows
//! is drawn as its solid twin instead (GL-2), as is every pane in solid mode.
//!
//! For each pane, or each run of panes side by side (group.rs), what is behind
//! it (the elements after it in the list) is drawn at half size into a texture
//! of its own, the pane and its hairline
//! plus the blur's reach (clipped to the screen), by a damage tracker of its
//! own: when nothing behind changed, nothing is drawn and the last blur is
//! kept, and the pane is not damaged on screen. Only when something did is it
//! blurred again (kawase.rs). The textures live with the GPU's EGL context
//! (cache.rs).

use std::time::Instant;

use smithay::{
    backend::renderer::{
        Bind, ImportAll, ImportMem, Offscreen, Renderer, Texture, gles::GlesTexture,
    },
    utils::{Physical, Rectangle, Size},
};

use super::{
    backdrop,
    cache::{self, Caches},
    element::{Frosted, GlassElement, PaneKey},
    group,
    shaders::{self, Programs},
    style::Style,
};
use crate::render::{DashiElement, GlesAccess};

/// Calls without a pane before its textures are let go.
const FORGET_AFTER: u64 = 600;

/// What one frosting did: how many panes, how many were blurred again, the tones read, and
/// whether a tone is still due (the screen must look again for it, still or not).
#[derive(Debug, Default, Clone)]
pub(crate) struct Frosting {
    pub panes: u32,
    pub blurred: u32,
    pub tones: Vec<(PaneKey, [u8; 3])>,
    pub tone_due: bool,
}

/// How a screen is frosted: its scale, how many layers of glass a pane may have under it
/// (none: as deep as last time), and the time of the frame.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Frame {
    pub scale: f64,
    pub deepest: Option<usize>,
    pub now: Instant,
}

/// Frost every pane in `elements`, a screen's (`screen`, in its pixels); a pane under more
/// than `frame.deepest` layers of glass is drawn solid.
pub(crate) fn frost<R>(
    renderer: &mut R,
    output: &str,
    screen: Size<i32, Physical>,
    Frame {
        scale,
        deepest,
        now,
    }: Frame,
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
        now,
    };
    let mut below: Vec<(Rectangle<i32, Physical>, usize)> = Vec::new();
    let mut at = elements.len();
    while at > 0 {
        at -= 1;
        let start = group::run_start(at, |i| match &elements[i] {
            DashiElement::Glass(glass) => Some(group::Sharing::of(glass)),
            _ => None,
        });
        let (front, behind) = elements.split_at_mut(at + 1);
        let mut run: Vec<&mut GlassElement> = Vec::new();
        for element in front[start..].iter_mut().rev() {
            let DashiElement::Glass(glass) = element else {
                continue;
            };
            let depth = backdrop::layers(&below, glass.visible()) + 1;
            below.push((glass.visible(), depth));
            if depth > deepest
                && let Some(look) = Style::solid_twin(glass.look, glass.twin)
            {
                glass.look = look;
            }
            if glass.look.solid.is_some() {
                let key = (output.to_owned(), glass.key.clone());
                let solid =
                    cache::solid(renderer.gles(), &programs, &mut caches, key, glass, &place)?;
                glass.frosted = Some(solid);
                done.panes += 1;
            } else {
                run.push(glass);
            }
        }
        if !run.is_empty() {
            frost_run(
                renderer,
                &programs,
                &mut caches,
                output,
                &mut run,
                behind,
                &place,
                &mut done,
            )?;
        }
        at = start;
    }
    cache::forget(renderer.gles(), &mut caches, FORGET_AFTER);
    Ok(done)
}

/// Where the panes of one frosting are: the screen, its scale, the turn, the time.
pub(super) struct Place {
    pub screen: Rectangle<i32, Physical>,
    pub scale: f64,
    pub turn: u64,
    pub now: Instant,
}

/// Frost a run of panes (group.rs: one surface's, side by side, the same blur) from what is
/// `behind` the backmost: drawn once over all of them and blurred once, each taking its part.
#[expect(
    clippy::too_many_arguments,
    reason = "the frosting's parts, passed as frost() holds them: the caches are borrowed apart"
)]
fn frost_run<R>(
    renderer: &mut R,
    programs: &Programs,
    caches: &mut Caches,
    output: &str,
    run: &mut [&mut GlassElement],
    behind: &[DashiElement<R>],
    place: &Place,
    done: &mut Frosting,
) -> Result<(), String>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess + Offscreen<GlesTexture> + Bind<GlesTexture>,
    R::TextureId: Texture + Clone + Send + 'static,
{
    let shown = run
        .iter()
        .filter_map(|glass| glass.outer().intersection(place.screen))
        .filter(|rect| !rect.is_empty())
        .reduce(|a, b| a.merge(b));
    let look = run[0].look;
    let Some(area) = shown.and_then(|shown| backdrop::area(shown, look.blur, place.screen)) else {
        for glass in run.iter_mut() {
            glass.frosted = None;
        }
        return Ok(());
    };
    // The run's textures are its first pane's (the lowest index: the one that stays as it scrolls).
    let Some(lead) = run
        .iter()
        .map(|glass| glass.key.clone())
        .min_by_key(|key| key.index)
    else {
        return Ok(());
    };
    let key = (output.to_owned(), lead);
    let (again, tone) = backdrop::blur_behind(
        renderer,
        programs,
        &mut caches.panes,
        &key,
        area,
        look,
        behind,
        place,
    )?;
    done.blurred += u32::from(again);
    done.tone_due |= caches
        .panes
        .get(&key)
        .is_some_and(|cache| cache.tone.pending());
    let Some(cache) = caches.panes.get(&key) else {
        return Ok(());
    };
    let texture = cache.pyramid.out.clone();
    for glass in run.iter_mut() {
        let outer = glass.outer();
        if outer
            .intersection(place.screen)
            .is_none_or(|rect| rect.is_empty())
        {
            glass.frosted = None;
            continue;
        }
        let member = (output.to_owned(), glass.key.clone());
        let (id, commit) = cache::member(&mut caches.members, member, glass, again, place.turn);
        // The pane's part of the picture (and its hairline's), at half size.
        let (x, y) = (
            f64::from(outer.loc.x - area.loc.x) / 2.0,
            f64::from(outer.loc.y - area.loc.y) / 2.0,
        );
        let (w, h) = (f64::from(outer.size.w) / 2.0, f64::from(outer.size.h) / 2.0);
        glass.frosted = Some(Frosted {
            id,
            commit,
            texture: texture.clone(),
            src: Rectangle::new((x, y).into(), (w, h).into()),
            program: programs.pane.clone(),
        });
        done.panes += 1;
        done.tones
            .extend(tone.map(|tone| (glass.key.clone(), tone)));
    }
    Ok(())
}
