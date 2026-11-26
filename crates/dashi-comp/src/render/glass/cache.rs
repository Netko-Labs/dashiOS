//! What frosting keeps from frame to frame, with the GPU's EGL context: each
//! run of panes' backdrop (group.rs; most runs are one pane), its own damage
//! tracker, its blur's textures and its tone; each pane's id and commit; and
//! a one-texel picture solid panes are drawn from.

use std::{cell::RefCell, collections::HashMap, rc::Rc};

use smithay::{
    backend::{
        allocator::Fourcc,
        renderer::{
            ImportMem, Offscreen,
            damage::OutputDamageTracker,
            element::Id,
            gles::{GlesRenderer, GlesTexture},
            utils::CommitCounter,
        },
    },
    utils::{Buffer, Physical, Point, Rectangle, Size, Transform},
};

use super::{
    element::{Frosted, GlassElement, PaneKey},
    frost::Place,
    kawase::Pyramid,
    shaders::Programs,
    style::Look,
    tone::Tone,
};

/// One run's textures and trackers, kept from frame to frame.
pub(super) struct Cache {
    pub backdrop: GlesTexture,
    pub tracker: OutputDamageTracker,
    pub pyramid: Pyramid,
    pub sigma: f64,
    /// Blurred at least once.
    pub blurred: bool,
    pub used: u64,
    pub tone: Tone,
}

/// A solid pane's id, commit, the look it was drawn with, and when it was last seen.
pub(super) type Solid = (Id, CommitCounter, Option<Look>, u64);

/// What a frosted pane was drawn with: its look, where its shape was in what is drawn, its size.
type Drawn = (Look, Point<i32, Physical>, Size<i32, Physical>);

/// A frosted pane's id and commit, what it was drawn with (its look, and where its shape was
/// in what is drawn: a cut pane scrolled), and when it was last seen.
pub(super) struct Member {
    id: Id,
    commit: CommitCounter,
    drawn: Option<Drawn>,
    used: u64,
}

pub(super) struct Caches {
    pub panes: HashMap<(String, PaneKey), Cache>,
    /// Frosted panes' ids and commits, by key.
    pub members: HashMap<(String, PaneKey), Member>,
    /// Solid panes, which need no backdrop: their id and commit, by key.
    pub solid: HashMap<(String, PaneKey), Solid>,
    pub blank: Option<GlesTexture>,
    pub turn: u64,
    /// How many layers of glass a pane may have under it, as a screen last said.
    pub deepest: usize,
}

impl Default for Caches {
    fn default() -> Self {
        Self {
            panes: HashMap::new(),
            members: HashMap::new(),
            solid: HashMap::new(),
            blank: None,
            turn: 0,
            deepest: usize::MAX,
        }
    }
}

struct Kept(Rc<RefCell<Caches>>);

pub(super) fn caches(gles: &mut GlesRenderer) -> Rc<RefCell<Caches>> {
    let data = gles.egl_context().user_data();
    data.insert_if_missing(|| Kept(Rc::default()));
    data.get::<Kept>()
        .map_or_else(Rc::default, |kept| kept.0.clone())
}

/// The one-texel picture solid panes are drawn from (their shader doesn't read it).
pub(super) fn blank(gles: &mut GlesRenderer, caches: &mut Caches) -> Result<GlesTexture, String> {
    if let Some(blank) = &caches.blank {
        return Ok(blank.clone());
    }
    let made = gles
        .import_memory(&[255; 4], Fourcc::Abgr8888, (1, 1).into(), false)
        .map_err(text)?;
    caches.blank = Some(made.clone());
    Ok(made)
}

/// Let go of the textures of panes not seen for a while.
pub(super) fn forget(gles: &mut GlesRenderer, caches: &mut Caches, after: u64) {
    let turn = caches.turn;
    let old: Vec<_> = caches
        .panes
        .iter()
        .filter(|(_, cache)| turn - cache.used >= after)
        .map(|(key, _)| key.clone())
        .collect();
    for key in old {
        if let Some(cache) = caches.panes.remove(&key) {
            cache.pyramid.free(gles);
        }
    }
    caches
        .solid
        .retain(|_, (_, _, _, used)| turn - *used < after);
    caches
        .members
        .retain(|_, member| turn - member.used < after);
}

/// `glass`'s id and commit as a frosted pane: its commit moves when its run was blurred again,
/// its look changed, or its shape moved in what is drawn.
pub(super) fn member(
    members: &mut HashMap<(String, PaneKey), Member>,
    key: (String, PaneKey),
    glass: &GlassElement,
    again: bool,
    turn: u64,
) -> (Id, CommitCounter) {
    let entry = members.entry(key).or_insert_with(|| Member {
        id: Id::new(),
        commit: CommitCounter::default(),
        drawn: None,
        used: turn,
    });
    let outer = glass.outer();
    let drawn = Some((
        glass.look,
        glass.geometry.loc - outer.loc,
        glass.geometry.size,
    ));
    if again || entry.drawn != drawn {
        entry.commit.increment();
        entry.drawn = drawn;
    }
    entry.used = turn;
    (entry.id.clone(), entry.commit)
}

/// A solid pane: no backdrop, its twin's colour; damaged only when its look changes.
pub(super) fn solid(
    gles: &mut GlesRenderer,
    programs: &Programs,
    caches: &mut Caches,
    key: (String, PaneKey),
    glass: &GlassElement,
    place: &Place,
) -> Result<Frosted, String> {
    let texture = blank(gles, caches)?;
    let entry = caches
        .solid
        .entry(key)
        .or_insert_with(|| (Id::new(), CommitCounter::default(), None, place.turn));
    if entry.2 != Some(glass.look) {
        entry.1.increment();
        entry.2 = Some(glass.look);
    }
    entry.3 = place.turn;
    Ok(Frosted {
        id: entry.0.clone(),
        commit: entry.1,
        texture,
        src: Rectangle::from_size((1.0, 1.0).into()),
        program: programs.pane.clone(),
    })
}

/// New textures for a run.
pub(super) fn fresh(
    gles: &mut GlesRenderer,
    size: Size<i32, Buffer>,
    passes: usize,
    sigma: f64,
    (scale, turn): (f64, u64),
) -> Result<Cache, String> {
    Ok(Cache {
        backdrop: gles.create_buffer(Fourcc::Abgr8888, size).map_err(text)?,
        tracker: OutputDamageTracker::new((size.w, size.h), scale, Transform::Normal),
        pyramid: Pyramid::new(gles, size, passes).map_err(text)?,
        sigma,
        blurred: false,
        used: turn,
        tone: Tone::default(),
    })
}

/// An error as text, for the log.
pub(super) fn text(error: impl std::fmt::Debug) -> String {
    format!("{error:?}")
}
