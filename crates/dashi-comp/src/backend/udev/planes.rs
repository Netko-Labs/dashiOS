//! When the display refuses a frame (an atomic commit fails with EINVAL), the
//! next is drawn another way rather than tried again as it was: first with no
//! client buffer on a plane (only the cursor plane), then with no planes at
//! all, everything drawn into the one picture. Planes come back after a while,
//! or sooner when the screen's windows change.
//!
//! Why: smithay (0.7) tests a plane's state only when it looks different
//! (position, size, format), so a commit the display refuses can get through
//! untested, and on a refusal it marks only a buffer on the primary plane as
//! failed. A refused buffer on an overlay or the cursor plane was tried again
//! every frame, and nothing new reached the screen until that window went
//! (12-flip: 1,751 refusals in 15 s on an AMD laptop).

use std::{fmt::Debug, time::Duration};

use smithay::backend::{
    allocator::Buffer,
    drm::{
        DrmError, Framebuffer,
        compositor::{FrameError, FrameFlags, PrimaryPlaneElement, RenderFrameResult},
    },
    renderer::element::{Element, Kind},
};
use smithay::output::Output;

/// How long the first fallback lasts before planes are tried again; each
/// retry the display refuses doubles it, to `LONGEST_WAIT`.
const FIRST_WAIT: Duration = Duration::from_secs(5);
const LONGEST_WAIT: Duration = Duration::from_secs(60);
/// The least time between a refusal and a retry when the windows change.
const LEAST_WAIT: Duration = Duration::from_secs(1);

/// The planes a frame may use, all first.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Level {
    #[default]
    All,
    /// The cursor plane only: client buffers are drawn into the picture.
    Cursor,
    /// No planes: the cursor too is drawn into the picture.
    None,
}

impl Level {
    pub(super) fn flags(self) -> FrameFlags {
        match self {
            Self::All => FrameFlags::DEFAULT,
            Self::Cursor => FrameFlags::ALLOW_CURSOR_PLANE_SCANOUT,
            Self::None => FrameFlags::empty(),
        }
    }

    pub(super) fn describe(self) -> &'static str {
        match self {
            Self::All => "every plane",
            Self::Cursor => "the cursor plane only",
            Self::None => "no planes",
        }
    }
}

/// What a frame put on planes besides the picture drawn on the primary.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Used {
    /// A client's buffer on the primary plane (direct scanout).
    pub primary: bool,
    pub overlays: usize,
    pub cursor: bool,
}

impl Used {
    pub(super) fn of<B: Buffer, F: Framebuffer, E>(frame: &RenderFrameResult<'_, B, F, E>) -> Self {
        Self {
            primary: matches!(frame.primary_element, PrimaryPlaneElement::Element(_)),
            overlays: frame.overlay_elements.len(),
            cursor: frame.cursor_element.is_some(),
        }
    }

    fn client_buffers(self) -> bool {
        self.primary || self.overlays > 0
    }

    fn any(self) -> bool {
        self.client_buffers() || self.cursor
    }
}

/// Whether a commit failed because the display refused it (EINVAL), not
/// because a flip is still pending (EBUSY) or the device went away.
pub(super) fn refused<A, B, F>(error: &FrameError<A, B, F>) -> bool
where
    A: std::error::Error + Send + Sync + 'static,
    B: std::error::Error + Send + Sync + 'static,
    F: std::error::Error + Send + Sync + 'static,
{
    match error {
        FrameError::DrmError(DrmError::Access(access)) => invalid(&access.source),
        _ => false,
    }
}

fn invalid(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::InvalidInput
}

/// The screen's windows, as a number that changes when they do (the cursor
/// left out, so its shape changing is not a change).
pub(super) fn scene<E: Element>(elements: &[E]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for element in elements.iter().filter(|e| e.kind() != Kind::Cursor) {
        element.id().hash(&mut hasher);
    }
    hasher.finish()
}

/// A run of refusals, from the first until planes are taken again.
#[derive(Debug)]
struct Episode {
    since: Duration,
    refused: u32,
    /// When the last refusal was, and the windows then.
    last: Duration,
    scene: u64,
    wait: Duration,
    /// Trying every plane again.
    retrying: bool,
    /// The level frames were last shown with in the meantime.
    shown: Option<Level>,
    /// Said that a frame with no planes was refused too.
    told_bare: bool,
}

/// What a refusal means, for the log.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Refusal {
    /// The first of a run: the one warning. The next frame uses `next`.
    First { next: Level },
    /// A frame that used no planes was refused: planes aren't the cause.
    /// Said once a run.
    Bare,
    /// Another in the run.
    Again { next: Level },
}

/// A run ended: planes are taken again.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Recovered {
    pub refused: u32,
    pub lasted: Duration,
    pub shown: Option<Level>,
}

/// One screen's planes (times are monotonic, as in flip.rs).
#[derive(Debug, Default)]
pub(super) struct Planes {
    level: Level,
    episode: Option<Episode>,
}

impl Planes {
    /// The planes the frame drawn `now` may use; `scene` is asked only during a fallback.
    pub(super) fn flags(&mut self, now: Duration, scene: impl FnOnce() -> u64) -> FrameFlags {
        if let Some(episode) = self.episode.as_mut()
            && self.level != Level::All
        {
            let waited = now.saturating_sub(episode.last);
            if waited >= episode.wait || (waited >= LEAST_WAIT && scene() != episode.scene) {
                self.level = Level::All;
                episode.retrying = true;
            }
        }
        self.level.flags()
    }

    /// The frame drawn `now`, which used `used`, was refused; `scene` is the windows then.
    pub(super) fn refused(&mut self, now: Duration, used: Used, scene: u64) -> Refusal {
        let next = match self.level {
            Level::All if used.client_buffers() => Level::Cursor,
            _ => Level::None,
        };
        self.level = next;
        let bare = !used.any();
        let Some(episode) = self.episode.as_mut() else {
            self.episode = Some(Episode {
                since: now,
                refused: 1,
                last: now,
                scene,
                wait: FIRST_WAIT,
                retrying: false,
                shown: None,
                told_bare: bare,
            });
            return Refusal::First { next };
        };
        episode.refused = episode.refused.saturating_add(1);
        episode.last = now;
        episode.scene = scene;
        if std::mem::replace(&mut episode.retrying, false) {
            episode.wait = (episode.wait * 2).min(LONGEST_WAIT);
        }
        if bare && !std::mem::replace(&mut episode.told_bare, true) {
            return Refusal::Bare;
        }
        Refusal::Again { next }
    }

    /// The frame drawn `now` was taken. Ends a run when it used every plane.
    pub(super) fn taken(&mut self, now: Duration) -> Option<Recovered> {
        if self.level != Level::All {
            if let Some(episode) = self.episode.as_mut() {
                episode.shown = Some(self.level);
            }
            return None;
        }
        let episode = self.episode.take()?;
        Some(Recovered {
            refused: episode.refused,
            lasted: now.saturating_sub(episode.since),
            shown: episode.shown,
        })
    }

    /// The screen was reset (a new mode, the session back): every plane again.
    pub(super) fn clear(&mut self) {
        self.level = Level::All;
        if let Some(episode) = self.episode.as_mut() {
            episode.retrying = true;
        }
    }
}

/// The log: one warning when a run starts, then quiet (debug) until it ends.
pub(super) fn tell_refused(output: &Output, refusal: &Refusal, used: Used, error: &dyn Debug) {
    let name = output.name();
    match refusal {
        Refusal::First { next } => tracing::warn!(
            output = name,
            ?error,
            primary = used.primary,
            overlays = used.overlays,
            cursor = used.cursor,
            "the screen refused a frame: drawing with {} until it takes planes again",
            next.describe()
        ),
        Refusal::Bare => tracing::warn!(
            output = name,
            ?error,
            "the screen refused a frame that used no planes: not a plane's fault"
        ),
        Refusal::Again { next } => tracing::debug!(
            output = name,
            ?error,
            primary = used.primary,
            overlays = used.overlays,
            cursor = used.cursor,
            "refused again: drawing with {}",
            next.describe()
        ),
    }
}

/// The run's one summary.
pub(super) fn tell_recovered(output: &Output, recovered: &Recovered) {
    tracing::info!(
        output = output.name(),
        refused = recovered.refused,
        seconds = recovered.lasted.as_secs_f64(),
        shown_with = recovered.shown.map_or("nothing", Level::describe),
        "planes back on: the screen takes every plane again"
    );
}

#[cfg(test)]
mod tests;
