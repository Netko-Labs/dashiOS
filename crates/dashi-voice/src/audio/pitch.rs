//! A voice's pitch, for saying how alike two voices are: the median of the
//! fundamental over the stretches that are voiced, by autocorrelation.

/// The lowest and highest pitch looked for (Hz): a deep man's voice to a high woman's.
const LOWEST: f32 = 60.0;
const HIGHEST: f32 = 400.0;

/// The pitch of one stretch, when it has one: the lag at which it best matches itself.
fn pitch(frame: &[f32], rate: u32) -> Option<f32> {
    let energy: f32 = frame.iter().map(|sample| sample * sample).sum();
    if energy / (frame.len() as f32) < 1e-4 {
        return None;
    }
    let shortest = (rate as f32 / HIGHEST) as usize;
    let longest = ((rate as f32 / LOWEST) as usize).min(frame.len() / 2);
    let mut best = (0, 0.0_f32);
    for lag in shortest..=longest {
        let (head, tail) = (&frame[..frame.len() - lag], &frame[lag..]);
        let match_: f32 = head.iter().zip(tail).map(|(a, b)| a * b).sum();
        let norm: f32 = head.iter().map(|a| a * a).sum::<f32>().sqrt()
            * tail.iter().map(|b| b * b).sum::<f32>().sqrt();
        let score = match_ / norm.max(1e-9);
        // A longer lag must match clearly better: twice the period matches as well as once.
        if score > best.1 + 0.02 {
            best = (lag, score);
        }
    }
    (best.1 > 0.6).then(|| rate as f32 / best.0 as f32)
}

/// The median pitch of the voiced stretches (Hz); 0 when there are none.
pub(crate) fn median_hz(samples: &[f32], rate: u32) -> f32 {
    let frame = rate as usize / 25;
    let mut pitches: Vec<f32> = samples
        .chunks(frame)
        .filter(|chunk| chunk.len() == frame)
        .filter_map(|chunk| pitch(chunk, rate))
        .collect();
    pitches.sort_by(f32::total_cmp);
    pitches.get(pitches.len() / 2).copied().unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(hz: f32, rate: u32) -> Vec<f32> {
        (0..rate)
            .map(|at| {
                let time = at as f32 / rate as f32;
                // A fundamental and its second harmonic, as a voice has.
                0.3 * (std::f32::consts::TAU * hz * time).sin()
                    + 0.15 * (std::f32::consts::TAU * 2.0 * hz * time).sin()
            })
            .collect()
    }

    #[test]
    fn a_tones_pitch_is_found_and_silence_has_none() {
        for hz in [110.0, 200.0, 250.0] {
            let found = median_hz(&tone(hz, 24_000), 24_000);
            assert!((found - hz).abs() < hz * 0.03, "{hz} was {found}");
        }
        assert_eq!(median_hz(&[0.0; 24_000], 24_000), 0.0);
    }
}
