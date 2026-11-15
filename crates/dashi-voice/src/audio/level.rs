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

/// A stretch this loud or louder (RMS over 20 ms) is speech, not the hush between words.
const SPEECH: f32 = 0.006;

/// The 20 ms stretches of `samples` that are speech.
fn speech(samples: &[f32], rate: u32) -> impl Iterator<Item = &[f32]> {
    samples.chunks(rate as usize / 50).filter(|chunk| {
        let mean = chunk.iter().map(|sample| sample * sample).sum::<f32>() / chunk.len() as f32;
        mean.sqrt() >= SPEECH
    })
}

/// How many samples are speech.
pub(crate) fn speech_samples(samples: &[f32], rate: u32) -> usize {
    speech(samples, rate).map(<[f32]>::len).sum()
}

/// How loud the speech in these samples is (dBFS): the RMS of the stretches
/// that are speech, so a long pause does not make a voice seem quieter.
pub(crate) fn speech_db(samples: &[f32], rate: u32) -> f32 {
    let (mut sum, mut count) = (0.0_f64, 0_usize);
    for chunk in speech(samples, rate) {
        sum += chunk
            .iter()
            .map(|sample| f64::from(sample * sample))
            .sum::<f64>();
        count += chunk.len();
    }
    if count == 0 {
        return FLOOR_DB;
    }
    (10.0 * (sum / count as f64).max(1e-12).log10()) as f32
}

/// The hush before the first speech and after the last, in milliseconds.
pub(crate) fn hush_ms(samples: &[f32], rate: u32) -> (u64, u64) {
    let chunk = rate as usize / 50;
    let loud: Vec<bool> = samples
        .chunks(chunk)
        .map(|chunk| speech_samples(chunk, rate) > 0)
        .collect();
    let first = loud.iter().position(|loud| *loud).unwrap_or(loud.len());
    let last = loud.iter().rposition(|loud| *loud).map_or(0, |at| at + 1);
    (first as u64 * 20, (loud.len() - last) as u64 * 20)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_is_measured_without_the_hush_around_it() {
        let mut samples = vec![0.0; 2400];
        samples.extend(vec![0.1; 4800]);
        samples.extend(vec![0.001; 7200]);
        assert_eq!(speech_samples(&samples, 24_000), 4800);
        assert!((speech_db(&samples, 24_000) + 20.0).abs() < 0.01);
        assert_eq!(hush_ms(&samples, 24_000), (100, 300));
        assert_eq!(speech_db(&[0.0; 4800], 24_000), -60.0);
        assert_eq!(hush_ms(&[0.0; 4800], 24_000), (200, 200));
    }

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
