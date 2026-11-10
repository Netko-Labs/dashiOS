//! A switch between Spaces as it slides: the timer that finishes it, its
//! easing, and where each window is drawn meanwhile.

use std::time::{Duration, Instant};

use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::{Logical, Point},
};

use super::Slide;
use crate::state::Dashi;

/// How long a switch slides.
const SLIDE: Duration = Duration::from_millis(250);
/// Eased progress for a slide's linear `t`.
fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}
impl Dashi {
    /// Finish at `target` from wherever a held slide is (or back to the current Space).
    pub(super) fn animate_to(&mut self, target: usize) {
        let from = self.spaces.current;
        let (start, toward) = match self.spaces.slide {
            // Going back: the slide runs down from where it was held.
            Some(slide) if target == from => (slide.at, slide.to),
            Some(slide) if target == slide.to => (slide.at, target),
            _ => (0.0, target),
        };
        if toward == from || self.chrome_style.reduce_motion {
            self.spaces.slide = None;
            if target != from {
                self.switch_space_now(target);
            }
            return;
        }
        let back = target == from;
        self.spaces.slide = Some(Slide {
            from,
            to: toward,
            at: start,
        });
        let began = Instant::now();
        let remaining = if back { start } else { 1.0 - start };
        let length = SLIDE.mul_f64(remaining.max(0.2));
        let frame = Duration::from_millis(8);
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(frame), move |_, _, state| {
                let Some(slide) = state.spaces.slide.as_mut() else {
                    return TimeoutAction::Drop;
                };
                let t = ease(began.elapsed().as_secs_f64() / length.as_secs_f64());
                slide.at = if back {
                    start * (1.0 - t)
                } else {
                    start + (1.0 - start) * t
                };
                if t < 1.0 {
                    return TimeoutAction::ToDuration(frame);
                }
                // Where it ends is read back: a Space added meanwhile moves it up one.
                let toward = slide.to;
                state.spaces.slide = None;
                if !back {
                    state.switch_space_now(toward);
                }
                TimeoutAction::Drop
            });
    }

    /// Where a window on Space `space` is drawn during a slide, by the slide's offset (logical, x).
    pub(crate) fn slide_offset(&self, space: usize, width: i32) -> Option<Point<i32, Logical>> {
        let slide = self.spaces.slide?;
        let dir = if slide.to > slide.from { 1.0 } else { -1.0 };
        let w = f64::from(width);
        let dx = if space == slide.from {
            -dir * slide.at * w
        } else if space == slide.to {
            dir * (1.0 - slide.at) * w
        } else {
            return None;
        };
        Some(Point::from((dx.round() as i32, 0)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slides_ease_out_and_stay_in_range() {
        assert_eq!(ease(0.0), 0.0);
        assert_eq!(ease(1.0), 1.0);
        assert_eq!(ease(2.0), 1.0);
        assert!(ease(0.5) > 0.5, "fast first, then slow");
    }
}
