//! The focus cross-fade of a window's shadow.

use std::time::{Duration, Instant};

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
