//! Sound as numbers: WAV files for the command line and the tests, the rate
//! change between what a file or a model has and what another wants, levels
//! for a meter, and PipeWire's tools for the microphone and the speakers.

pub(crate) mod level;
pub(crate) mod pipewire;
pub(crate) mod resample;
pub(crate) mod wav;

/// What the listening models hear: 16 kHz, one channel.
pub(crate) const LISTEN_RATE: u32 = 16_000;
/// What Kokoro speaks: 24 kHz, one channel.
pub(crate) const SPEAK_RATE: u32 = 24_000;

/// Signed 16-bit little-endian bytes to samples from -1 to 1.
pub(crate) fn from_s16le(bytes: &[u8]) -> Vec<f32> {
    let (pairs, _) = bytes.as_chunks::<2>();
    pairs
        .iter()
        .map(|pair| f32::from(i16::from_le_bytes(*pair)) / 32768.0)
        .collect()
}

/// Samples from -1 to 1 to signed 16-bit little-endian bytes.
pub(crate) fn to_s16le(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| ((sample.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_survive_the_trip_through_bytes() {
        let samples = [0.0, 0.5, -0.5, 1.0, -1.0];
        let back = from_s16le(&to_s16le(&samples));
        for (a, b) in samples.iter().zip(&back) {
            assert!((a - b).abs() < 0.001, "{a} became {b}");
        }
        // A sample out of range is held at the edge, never wrapped.
        assert_eq!(to_s16le(&[3.0]), 32767i16.to_le_bytes());
    }
}
