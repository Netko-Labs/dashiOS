//! Changing a sound's rate: a windowed-sinc filter, cut at half the lower
//! rate so nothing folds back. Used for files (a WAV at any rate, heard at
//! 16 kHz); live sound is asked of PipeWire at the right rate already.

use std::f32::consts::PI;

/// Zero crossings of the filter on each side: more is sharper and slower.
const WINGS: f32 = 16.0;

pub(crate) fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() || from == 0 || to == 0 {
        return samples.to_vec();
    }
    let step = from as f64 / to as f64;
    // Going down, the filter is stretched so it cuts at the new rate's half.
    let stretch = (step as f32).max(1.0);
    let reach = (WINGS * stretch).ceil() as isize;
    let length = (samples.len() as f64 / step).floor() as usize;
    (0..length)
        .map(|index| {
            let centre = index as f64 * step;
            let first = centre.floor() as isize - reach + 1;
            let mut sum = 0.0;
            let mut weight = 0.0;
            for at in first..first + 2 * reach {
                let Some(sample) = usize::try_from(at).ok().and_then(|at| samples.get(at)) else {
                    continue;
                };
                let w = kernel(((at as f64 - centre) as f32) / stretch);
                sum += sample * w;
                weight += w;
            }
            if weight.abs() > 1e-6 {
                sum / weight
            } else {
                0.0
            }
        })
        .collect()
}

/// sinc under a Hann window, zero past the wings.
fn kernel(x: f32) -> f32 {
    if x.abs() >= WINGS {
        return 0.0;
    }
    if x.abs() < 1e-6 {
        return 1.0;
    }
    let sinc = (PI * x).sin() / (PI * x);
    sinc * 0.5 * (1.0 + (PI * x / WINGS).cos())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, rate: u32, seconds: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|n| (2.0 * PI * hz * n as f32 / rate as f32).sin())
            .collect()
    }

    fn loudness(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    #[test]
    fn a_tone_keeps_its_length_and_loudness() {
        let down = resample(&tone(440.0, 24_000, 0.5), 24_000, 16_000);
        assert_eq!(down.len(), 8_000);
        assert!((loudness(&down[200..7_800]) - 0.707).abs() < 0.02);
        let up = resample(&tone(440.0, 16_000, 0.5), 16_000, 48_000);
        assert_eq!(up.len(), 24_000);
        assert!((loudness(&up[600..23_400]) - 0.707).abs() < 0.02);
    }

    #[test]
    fn what_the_new_rate_cannot_hold_is_cut() {
        // 11 kHz can't live in a 16 kHz sound (8 kHz at most): it must not fold back.
        let down = resample(&tone(11_000.0, 48_000, 0.25), 48_000, 16_000);
        assert!(loudness(&down[200..3_800]) < 0.02);
    }

    #[test]
    fn the_same_rate_changes_nothing() {
        assert_eq!(resample(&[0.1, 0.2], 16_000, 16_000), vec![0.1, 0.2]);
        assert!(resample(&[], 16_000, 8_000).is_empty());
    }
}
