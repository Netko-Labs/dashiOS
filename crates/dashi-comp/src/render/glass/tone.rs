//! The backdrop's tone: the mean colour behind a pane, blurred and lifted,
//! before the tint, so the words on it can lean toward its hue (Frost's
//! vibrant inks). Read back from the blur's smallest picture, which waits for
//! the GPU: a fresh pane's at once, on its first frosting, whatever moves
//! behind it; after that only when the backdrop has settled (or every second
//! while it keeps moving), at most every 120 ms, and sent only when it changed.

use std::time::{Duration, Instant};

/// The least time between two reads of one pane's tone.
pub(super) const EVERY: Duration = Duration::from_millis(120);
/// While the backdrop keeps changing, a read at least this often.
const MOVING: Duration = Duration::from_secs(1);
/// A change smaller than this (of 255, any channel) is not sent.
const STEP: u8 = 2;

/// One pane's tone, kept with its textures.
#[derive(Debug, Default)]
pub(super) struct Tone {
    read: Option<Instant>,
    /// Changed since the last read.
    due: bool,
    sent: Option<[u8; 3]>,
}

impl Tone {
    /// After a frosting (`changed`: blurred again), whether to read the tone now. A pane
    /// never read is read at once: waiting for its backdrop to settle left a pane over a video
    /// or a live wallpaper without a tone for as long as it played (D739).
    pub(super) fn wants(&mut self, changed: bool, now: Instant) -> bool {
        self.due |= changed;
        if !self.due {
            return false;
        }
        let since = self.read.map(|at| now.saturating_duration_since(at));
        let ready = match since {
            None => true,
            Some(since) => since >= EVERY && (!changed || since >= MOVING),
        };
        if ready {
            self.due = false;
            self.read = Some(now);
        }
        ready
    }

    /// A tone is due and not read yet: the screen must look again for it.
    pub(super) fn pending(&self) -> bool {
        self.due
    }

    /// The tone read: what to send (none when it hardly changed).
    pub(super) fn read(&mut self, rgb: [f32; 3]) -> Option<[u8; 3]> {
        let bytes = rgb.map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8);
        let same = self
            .sent
            .is_some_and(|sent| sent.iter().zip(bytes).all(|(a, b)| a.abs_diff(b) < STEP));
        if same {
            return None;
        }
        self.sent = Some(bytes);
        Some(bytes)
    }
}

/// The colour lifted as the pane's shader lifts it (saturation, then brightness).
pub(super) fn lifted(rgb: [f32; 3], saturation: f32, brightness: f32) -> [f32; 3] {
    let l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    rgb.map(|c| ((l + (c - l) * saturation) * brightness).clamp(0.0, 1.0))
}

/// As the protocol sends it: 0xRRGGBB.
pub(crate) fn wire([r, g, b]: [u8; 3]) -> u32 {
    (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b)
}

/// As the IPC sends it: `#rrggbb`.
pub(crate) fn hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tone_waits_for_the_backdrop_to_settle_and_never_comes_too_often() {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut tone = Tone::default();
        // Nothing changed yet: nothing to read.
        assert!(!tone.wants(false, at(0)));
        // Blurred for the first time: read at once, moving or not.
        assert!(tone.wants(true, at(20)));
        assert!(!tone.wants(false, at(30)));
        // A change soon after: due, but not before 120 ms have passed.
        assert!(!tone.wants(true, at(40)));
        assert!(!tone.wants(false, at(100)));
        assert!(tone.wants(false, at(140)));
        // Moving all the time: once a second.
        for ms in (160..1100).step_by(16) {
            assert!(!tone.wants(true, at(ms)), "{ms}");
        }
        assert!(tone.wants(true, at(1150)));
    }

    /// The kit's run (dashi-0.10.0-review/28-glass-kit): a fresh pane must hear its tone at
    /// once, whether the screen is still or something moves behind it from the first frame
    /// (a video, a live wallpaper): a pane frosted at 60 Hz, blurred again every time.
    #[test]
    fn a_fresh_pane_hears_its_tone_within_120_ms_still_or_moving() {
        let start = Instant::now();
        let frame = |n: u64| start + Duration::from_micros(16_667 * n);
        // A still screen: blurred once (the first frosting), then nothing changes.
        let mut still = Tone::default();
        let first = (0..60).find(|&n| still.wants(n == 0, frame(n)));
        assert!(
            first.is_some_and(|n| frame(n) - start <= EVERY),
            "still: {first:?}"
        );
        // A moving backdrop: blurred again on every frosting, from the first.
        let mut moving = Tone::default();
        let first = (0..120).find(|&n| moving.wants(true, frame(n)));
        assert!(
            first.is_some_and(|n| frame(n) - start <= EVERY),
            "moving: {first:?}"
        );
    }

    #[test]
    fn a_tone_is_sent_only_when_it_changed() {
        let mut tone = Tone::default();
        assert_eq!(tone.read([1.0, 0.5, 0.0]), Some([255, 128, 0]));
        assert_eq!(tone.read([1.0, 0.502, 0.0]), None);
        assert_eq!(tone.read([1.0, 0.6, 0.0]), Some([255, 153, 0]));
        assert_eq!(wire([255, 153, 0]), 0xff9900);
        assert_eq!(hex([255, 153, 0]), "#ff9900");
    }

    #[test]
    fn the_tone_is_lifted_as_the_glass_is() {
        assert_eq!(lifted([0.5; 3], 1.8, 1.0), [0.5; 3]);
        let lifted = lifted([0.6, 0.4, 0.4], 2.0, 1.0);
        assert!(lifted[0] > 0.6 && lifted[1] < 0.4);
        assert_eq!(super::lifted([0.9; 3], 1.0, 2.0), [1.0; 3]);
    }
}
