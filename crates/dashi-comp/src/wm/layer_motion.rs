//! Shell surfaces that come in with motion: a layer surface whose namespace the
//! shell named in `layer-motion` fades in from a slightly smaller size when it
//! first draws (the launcher: 160 ms from 0.96, ease-out cubic). Which surfaces,
//! how long and from what size is the shell's; with `chrome {reduceMotion}`
//! they simply appear.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use smithay::reexports::wayland_server::backend::ObjectId;

use crate::ipc::protocol::{Millis, Real};

/// MO-1: nothing on the way to what the person asked for takes longer.
const MAX_MS: u64 = 300;

/// How long an entrance takes: 0 (none) to 300 ms.
type Ms = Millis<{ MAX_MS as i64 }>;
/// The size an entrance starts at, 0.5 to 1 of its own.
type Scale = Real<500, 1000>;

/// `layer-motion`'s params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LayerMotionParams {
    pub namespace: String,
    pub ms: Ms,
    pub scale: Option<Scale>,
}

/// How a namespace's surfaces come in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Appear {
    duration: Duration,
    /// The size it starts at, 0.5 to 1 of its own.
    from_scale: f64,
}

/// Where a surface's entrance is now: its opacity and its scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Step {
    pub alpha: f32,
    pub scale: f64,
}

#[derive(Default)]
pub(crate) struct LayerMotion {
    by_namespace: HashMap<String, Appear>,
    /// Surfaces of those namespaces: when each first drew (None until it has).
    entering: HashMap<ObjectId, (Appear, Option<Instant>)>,
}

impl LayerMotion {
    /// `layer-motion {namespace, ms, scale}`; `ms` 0 stops it for that namespace.
    pub(crate) fn set(&mut self, params: &LayerMotionParams) -> Result<(), String> {
        let namespace = params.namespace.as_str();
        if namespace.is_empty() || namespace.len() > 64 {
            return Err("`namespace` must be a name".into());
        }
        let ms = params.ms.to::<u64>();
        let from_scale = params.scale.map_or(1.0, Scale::get);
        if ms == 0 {
            self.by_namespace.remove(namespace);
        } else {
            self.by_namespace.insert(
                namespace.to_owned(),
                Appear {
                    duration: Duration::from_millis(ms),
                    from_scale,
                },
            );
        }
        Ok(())
    }

    /// A layer surface was made: one of a moving namespace comes in when it first draws.
    pub(crate) fn made(&mut self, surface: ObjectId, namespace: &str) {
        if let Some(appear) = self.by_namespace.get(namespace) {
            self.entering.insert(surface, (*appear, None));
        }
    }

    pub(crate) fn gone(&mut self, surface: &ObjectId) {
        self.entering.remove(surface);
    }

    /// How to draw `surface` now (None: as it is). `drawn` says it has something to show;
    /// its entrance starts at the first frame it does. `reduce` skips it.
    pub(crate) fn step(
        &mut self,
        surface: &ObjectId,
        drawn: bool,
        reduce: bool,
        now: Instant,
    ) -> Option<Step> {
        let (appear, started) = self.entering.get_mut(surface)?;
        if reduce {
            self.entering.remove(surface);
            return None;
        }
        if !drawn {
            return None;
        }
        let since = now.saturating_duration_since(*started.get_or_insert(now));
        let step = appear.at(since);
        if step.is_none() {
            self.entering.remove(surface);
        }
        step
    }
}

impl Appear {
    /// The entrance `since` its start; None once it is over.
    fn at(&self, since: Duration) -> Option<Step> {
        let t = since.as_secs_f64() / self.duration.as_secs_f64();
        if t >= 1.0 {
            return None;
        }
        let eased = 1.0 - (1.0 - t).powi(3);
        Some(Step {
            alpha: eased as f32,
            scale: self.from_scale + (1.0 - self.from_scale) * eased,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn params(value: Value) -> Value {
        value
    }

    impl LayerMotion {
        fn set_json(&mut self, value: &Value) -> Result<(), String> {
            self.set(&crate::ipc::protocol::read(value.clone())?)
        }
    }

    #[test]
    fn an_entrance_fades_in_from_its_scale_on_the_curve() {
        let appear = Appear {
            duration: Duration::from_millis(160),
            from_scale: 0.96,
        };
        let start = appear.at(Duration::ZERO).unwrap();
        assert_eq!(start.alpha, 0.0);
        assert!((start.scale - 0.96).abs() < 1e-9);
        // Ease-out cubic: seven eighths of the way at half the time.
        let half = appear.at(Duration::from_millis(80)).unwrap();
        assert!((f64::from(half.alpha) - 0.875).abs() < 1e-6);
        assert!((half.scale - (0.96 + 0.04 * 0.875)).abs() < 1e-9);
        assert_eq!(appear.at(Duration::from_millis(160)), None);
    }

    #[test]
    fn only_named_namespaces_move_and_only_from_their_first_frame() {
        let mut motion = LayerMotion::default();
        motion
            .set_json(&params(
                json!({ "namespace": "dashi.launcher", "ms": 160, "scale": 0.96 }),
            ))
            .unwrap();
        let id = ObjectId::null();
        motion.made(id.clone(), "dashi.menubar");
        let now = Instant::now();
        assert_eq!(motion.step(&id, true, false, now), None);
        motion.made(id.clone(), "dashi.launcher");
        // Nothing drawn yet: nothing to fade, and the clock hasn't started.
        assert_eq!(motion.step(&id, false, false, now), None);
        let later = now + Duration::from_millis(500);
        assert_eq!(
            motion.step(&id, true, false, later).map(|s| s.alpha),
            Some(0.0)
        );
        assert!(
            motion
                .step(&id, true, false, later + Duration::from_millis(80))
                .is_some()
        );
        assert_eq!(
            motion.step(&id, true, false, later + Duration::from_millis(200)),
            None
        );
        // Over: drawn as it is from then on.
        assert_eq!(motion.step(&id, true, false, later), None);
    }

    #[test]
    fn reduce_motion_and_a_stop_leave_surfaces_be() {
        let mut motion = LayerMotion::default();
        motion
            .set_json(&params(
                json!({ "namespace": "dashi.launcher", "ms": 160, "scale": 0.96 }),
            ))
            .unwrap();
        let id = ObjectId::null();
        motion.made(id.clone(), "dashi.launcher");
        assert_eq!(motion.step(&id, true, true, Instant::now()), None);
        motion
            .set_json(&params(json!({ "namespace": "dashi.launcher", "ms": 0 })))
            .unwrap();
        motion.made(id.clone(), "dashi.launcher");
        assert_eq!(motion.step(&id, true, false, Instant::now()), None);
    }

    #[test]
    fn bad_requests_are_refused() {
        let mut motion = LayerMotion::default();
        assert!(motion.set_json(&params(json!({ "ms": 160 }))).is_err());
        assert!(
            motion
                .set_json(&params(json!({ "namespace": "x", "ms": 301 })))
                .is_err()
        );
        assert!(
            motion
                .set_json(&params(
                    json!({ "namespace": "x", "ms": 100, "scale": 0.2 })
                ))
                .is_err()
        );
        assert!(
            motion
                .set_json(&params(json!({ "namespace": "", "ms": 100 })))
                .is_err()
        );
    }
}
