//! Sound as Whisper hears it: a log-mel spectrogram. 25 ms windows every
//! 10 ms, their power spread over mel bands (Slaney's scale, as librosa and
//! OpenAI's Whisper make them), then log10, held within 8 of the loudest, and
//! scaled. The numbers must match what the model was trained on, to the bin.

use std::f32::consts::PI;

const WINDOW: usize = 400;
const HOP: usize = 160;
const BINS: usize = WINDOW / 2 + 1;
const RATE: f32 = 16_000.0;

fn hz_to_mel(hz: f32) -> f32 {
    if hz < 1000.0 {
        hz * 3.0 / 200.0
    } else {
        15.0 + (hz / 1000.0).ln() / (6.4f32.ln() / 27.0)
    }
}

fn mel_to_hz(mel: f32) -> f32 {
    if mel < 15.0 {
        mel * 200.0 / 3.0
    } else {
        1000.0 * ((mel - 15.0) * (6.4f32.ln() / 27.0)).exp()
    }
}

/// The mel bands' weights over the spectrum's bins: `bands` rows of `BINS`.
pub(crate) fn filters(bands: usize) -> Vec<f32> {
    let top = hz_to_mel(RATE / 2.0);
    let edges: Vec<f32> = (0..bands + 2)
        .map(|index| mel_to_hz(top * index as f32 / (bands + 1) as f32))
        .collect();
    let mut weights = vec![0.0; bands * BINS];
    for band in 0..bands {
        let (low, mid, high) = (edges[band], edges[band + 1], edges[band + 2]);
        let scale = 2.0 / (high - low);
        for bin in 0..BINS {
            let hz = bin as f32 * RATE / WINDOW as f32;
            let rise = (hz - low) / (mid - low);
            let fall = (high - hz) / (high - mid);
            weights[band * BINS + bin] = rise.min(fall).max(0.0) * scale;
        }
    }
    weights
}

/// The power in each bin of each window: `frames` rows of `BINS`. The sound
/// is mirrored half a window past each end, as a centred transform is.
fn power(samples: &[f32], frames: usize) -> Vec<f32> {
    let half = WINDOW / 2;
    let at = |index: isize| -> f32 {
        let last = samples.len() as isize - 1;
        let index = if index < 0 {
            -index
        } else if index > last {
            2 * last - index
        } else {
            index
        };
        samples.get(index.max(0) as usize).copied().unwrap_or(0.0)
    };
    let hann: Vec<f32> = (0..WINDOW)
        .map(|n| 0.5 - 0.5 * (2.0 * PI * n as f32 / WINDOW as f32).cos())
        .collect();
    let turn: Vec<(f32, f32)> = (0..WINDOW)
        .map(|n| {
            let angle = 2.0 * PI * n as f32 / WINDOW as f32;
            (angle.cos(), angle.sin())
        })
        .collect();
    let mut out = vec![0.0; frames * BINS];
    let workers = crate::engine::runtime::threads();
    let rows = frames.div_ceil(workers).max(1);
    std::thread::scope(|scope| {
        for (chunk, slice) in out.chunks_mut(rows * BINS).enumerate() {
            let (hann, turn, at) = (&hann, &turn, &at);
            scope.spawn(move || {
                let mut window = [0.0f32; WINDOW];
                for (row, bins) in slice.chunks_mut(BINS).enumerate() {
                    let start = ((chunk * rows + row) * HOP) as isize - half as isize;
                    for (n, value) in window.iter_mut().enumerate() {
                        *value = at(start + n as isize) * hann[n];
                    }
                    for (bin, value) in bins.iter_mut().enumerate() {
                        let (mut real, mut imaginary) = (0.0f32, 0.0f32);
                        for (n, sample) in window.iter().enumerate() {
                            let (cos, sin) = turn[(bin * n) % WINDOW];
                            real += sample * cos;
                            imaginary -= sample * sin;
                        }
                        *value = real * real + imaginary * imaginary;
                    }
                }
            });
        }
    });
    out
}

/// The log-mel spectrogram: `bands` rows of `frames` (the model's layout),
/// and how many frames. `samples` is 16 kHz; a frame is 10 ms.
pub(crate) fn log_mel(samples: &[f32], filters: &[f32], bands: usize) -> (Vec<f32>, usize) {
    let frames = samples.len() / HOP;
    let power = power(samples, frames);
    let mut mel = vec![0.0f32; bands * frames];
    let mut loudest = f32::MIN;
    for frame in 0..frames {
        let bins = &power[frame * BINS..(frame + 1) * BINS];
        for band in 0..bands {
            let weights = &filters[band * BINS..(band + 1) * BINS];
            let sum: f32 = bins.iter().zip(weights).map(|(p, w)| p * w).sum();
            let log = sum.max(1e-10).log10();
            loudest = loudest.max(log);
            mel[band * frames + frame] = log;
        }
    }
    for value in &mut mel {
        *value = (value.max(loudest - 8.0) + 4.0) / 4.0;
    }
    (mel, frames)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bands_cover_the_spectrum_as_librosa_does() {
        let weights = filters(80);
        assert_eq!(weights.len(), 80 * BINS);
        // librosa.filters.mel(sr=16000, n_fft=400, n_mels=80): the first band peaks at bin 1.
        assert!((weights[1] - 0.024_862_6).abs() < 1e-4, "{}", weights[1]);
        assert_eq!(weights[0], 0.0);
        // Every band has weight, and none is negative.
        for band in 0..80 {
            let row = &weights[band * BINS..(band + 1) * BINS];
            assert!(row.iter().sum::<f32>() > 0.0);
            assert!(row.iter().all(|w| *w >= 0.0));
        }
    }

    #[test]
    fn a_tone_lights_its_own_band() {
        let samples: Vec<f32> = (0..16_000)
            .map(|n| (2.0 * PI * 1000.0 * n as f32 / RATE).sin())
            .collect();
        let bands = 128;
        let (mel, frames) = log_mel(&samples, &filters(bands), bands);
        assert_eq!(frames, 100);
        let middle = 50;
        let column: Vec<f32> = (0..bands).map(|band| mel[band * frames + middle]).collect();
        let loudest = crate::engine::tensor::argmax(&column);
        // 1 kHz is mel 15 of 0 to ~45.2 (8 kHz): band 15 / 45.2 * 129 - 1, about 42.
        assert!((40..=44).contains(&loudest), "{loudest}");
        // Nothing is more than 8 (2 after scaling) below the loudest.
        let top = column[loudest];
        assert!(column.iter().all(|value| top - value <= 2.0 + 1e-4));
    }
}
