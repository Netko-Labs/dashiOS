//! How loud a stretch of sound is, for a meter: 0 is silence, 1 is as loud
//! as speech close to the microphone gets.

/// Quiet enough to draw as nothing (dBFS).
const FLOOR_DB: f32 = -60.0;

/// The loudness of these samples from 0 to 1: their RMS on a decibel scale,
/// -60 dBFS and below is 0, full scale is 1.
pub(crate) fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mean = samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32;
    let db = 10.0 * mean.max(1e-12).log10();
    ((db - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_is_nothing_and_full_scale_is_one() {
        assert_eq!(level(&[]), 0.0);
        assert_eq!(level(&[0.0; 512]), 0.0);
        assert_eq!(level(&[1.0; 512]), 1.0);
        let speech = level(&[0.1; 512]);
        assert!((speech - 0.667).abs() < 0.01, "{speech}");
        assert!(level(&[0.01; 512]) < speech);
    }
}
