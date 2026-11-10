//! Where presses came from: the person's hands (libinput), or an agent's
//! (`agent-input`, even when it borrows the person's seat). Each button or
//! key press is noted against what received it, a shell layer surface by its
//! namespace or a window by its id, so the shell can tell whether a consent
//! sheet was answered by the person (`input-origin`). The decision is the
//! shell's; this only remembers.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::ipc::protocol::Int;
use smithay::{
    desktop::WindowSurfaceType, reexports::wayland_server::protocol::wl_surface::WlSurface,
};

use crate::state::Dashi;

/// Presses older than this are forgotten.
const KEEP: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Target {
    Layer(String),
    Window(u64),
}

#[derive(Default)]
pub(crate) struct Origins {
    person: HashMap<Target, Instant>,
    agent: HashMap<Target, Instant>,
}

impl Origins {
    fn note(map: &mut HashMap<Target, Instant>, target: Target, now: Instant) {
        map.retain(|_, at| now.duration_since(*at) < KEEP);
        map.insert(target, now);
    }

    pub(crate) fn person(&mut self, target: Target, now: Instant) {
        Self::note(&mut self.person, target, now);
    }

    pub(crate) fn agent(&mut self, target: Target, now: Instant) {
        Self::note(&mut self.agent, target, now);
    }

    /// How long ago each last pressed `target`, in ms (null: not in the last minute).
    pub(crate) fn describe(&self, target: &Target, now: Instant) -> Origin {
        let ago = |map: &HashMap<Target, Instant>| {
            map.get(target)
                .map(|at| now.duration_since(*at))
                .filter(|d| *d < KEEP)
                .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        };
        Origin {
            person: ago(&self.person),
            agent: ago(&self.agent),
        }
    }
}

/// `{namespace}` or `{window}`, what `input-origin` asks about.
/// `input-origin`'s params: a shell layer by `namespace`, or a `window`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OriginParams {
    pub namespace: Option<String>,
    pub window: Option<Int<0, { i64::MAX }>>,
}

/// How long ago (ms, within the last minute) the person's own hands and an
/// agent last pressed there.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Origin {
    pub person: Option<u64>,
    pub agent: Option<u64>,
}

pub(crate) fn parse_target(params: &OriginParams) -> Result<Target, String> {
    if let Some(namespace) = &params.namespace {
        return Ok(Target::Layer(namespace.clone()));
    }
    params
        .window
        .map(|window| Target::Window(window.to::<u64>()))
        .ok_or_else(|| "input-origin needs a `namespace` or a `window`".into())
}

impl Dashi {
    /// What `surface` belongs to: a shell layer (by namespace) or a window.
    pub(crate) fn press_target(&self, surface: &WlSurface) -> Option<Target> {
        for output in self.space.outputs() {
            let layers = smithay::desktop::layer_map_for_output(output);
            if let Some(layer) = layers.layer_for_surface(surface, WindowSurfaceType::ALL) {
                return Some(Target::Layer(layer.namespace().to_owned()));
            }
        }
        // A subsurface counts as its window's.
        let mut root = surface.clone();
        while let Some(parent) = smithay::wayland::compositor::get_parent(&root) {
            root = parent;
        }
        crate::wm::window_id_for_surface(self, &root).map(Target::Window)
    }

    /// The person pressed a button or a key: note what got it.
    pub(crate) fn note_person_press(&mut self, surface: Option<WlSurface>) {
        if let Some(target) = surface.as_ref().and_then(|s| self.press_target(s)) {
            self.origins.person(target, Instant::now());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presses_are_told_apart_by_whose_they_were() {
        let mut origins = Origins::default();
        let start = Instant::now();
        let sheet = Target::Layer("dashi.agent-consent".into());
        origins.agent(Target::Window(3), start);
        origins.person(sheet.clone(), start);
        let later = start + Duration::from_millis(250);
        assert_eq!(
            origins.describe(&sheet, later),
            Origin {
                person: Some(250),
                agent: None
            }
        );
        assert_eq!(
            origins.describe(&Target::Window(3), later),
            Origin {
                person: None,
                agent: Some(250)
            }
        );
        // A minute on, nothing is remembered.
        assert_eq!(
            origins.describe(&sheet, start + KEEP),
            Origin {
                person: None,
                agent: None
            }
        );
    }

    use serde_json::json;

    #[test]
    fn targets_parse() {
        let params = |v: serde_json::Value| crate::ipc::protocol::read::<OriginParams>(v).unwrap();
        assert_eq!(
            parse_target(&params(json!({ "namespace": "dashi.agent-consent" }))),
            Ok(Target::Layer("dashi.agent-consent".into()))
        );
        assert_eq!(
            parse_target(&params(json!({ "window": 7 }))),
            Ok(Target::Window(7))
        );
        assert!(parse_target(&params(json!({}))).is_err());
    }
}
