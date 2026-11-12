//! WAV files, read and written: PCM (8, 16, 24 or 32 bits) and 32-bit float,
//! any rate, any channels (mixed down to one). Only the command line and the
//! tests use files; the service never writes sound to disk.

use std::path::Path;

pub(crate) struct Wav {
    pub(crate) rate: u32,
    /// One channel, from -1 to 1.
    pub(crate) samples: Vec<f32>,
}

const PCM: u16 = 1;
const FLOAT: u16 = 3;
const EXTENSIBLE: u16 = 0xFFFE;

struct Format {
    kind: u16,
    channels: usize,
    rate: u32,
    bits: u16,
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn format(chunk: &[u8]) -> Option<Format> {
    let mut kind = u16_at(chunk, 0)?;
    if kind == EXTENSIBLE {
        // The real format is the first two bytes of the sub-format GUID.
        kind = u16_at(chunk, 24)?;
    }
    Some(Format {
        kind,
        channels: usize::from(u16_at(chunk, 2)?),
        rate: u32_at(chunk, 4)?,
        bits: u16_at(chunk, 14)?,
    })
}

fn sample(format: &Format, bytes: &[u8]) -> f32 {
    match (format.kind, format.bits) {
        (PCM, 8) => (f32::from(bytes[0]) - 128.0) / 128.0,
        (PCM, 16) => f32::from(i16::from_le_bytes([bytes[0], bytes[1]])) / 32768.0,
        (PCM, 24) => {
            (i32::from_le_bytes([0, bytes[0], bytes[1], bytes[2]]) >> 8) as f32 / 8_388_608.0
        }
        (PCM, 32) => {
            i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32 / 2_147_483_648.0
        }
        _ => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
    }
}

pub(crate) fn parse(bytes: &[u8]) -> Result<Wav, String> {
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("not a WAV file".into());
    }
    let mut at = 12;
    let mut found: Option<Format> = None;
    while let (Some(id), Some(size)) = (bytes.get(at..at + 4), u32_at(bytes, at + 4)) {
        let start = at + 8;
        // A file cut short, or written to a pipe, may claim more than it holds.
        let end = start.saturating_add(size as usize).min(bytes.len());
        let chunk = &bytes[start..end];
        if id == b"fmt " {
            found = Some(format(chunk).ok_or("the WAV file's format is cut short")?);
        } else if id == b"data" {
            let format = found.ok_or("the WAV file has sound before its format")?;
            return decode(&format, chunk);
        }
        at = end + (size as usize & 1);
    }
    Err("the WAV file holds no sound".into())
}

fn decode(format: &Format, data: &[u8]) -> Result<Wav, String> {
    let known = matches!(
        (format.kind, format.bits),
        (PCM, 8 | 16 | 24 | 32) | (FLOAT, 32)
    );
    if !known || format.channels == 0 || format.rate == 0 {
        return Err(format!(
            "a WAV file of this kind can't be read (format {}, {} bits)",
            format.kind, format.bits
        ));
    }
    let width = usize::from(format.bits / 8);
    let samples = data
        .chunks_exact(width * format.channels)
        .map(|frame| {
            let sum: f32 = frame
                .chunks_exact(width)
                .map(|one| sample(format, one))
                .sum();
            sum / format.channels as f32
        })
        .collect();
    Ok(Wav {
        rate: format.rate,
        samples,
    })
}

pub(crate) fn read(path: &Path) -> Result<Wav, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    parse(&bytes).map_err(|error| format!("{}: {error}", path.display()))
}

/// A 16-bit, one-channel WAV file's bytes.
pub(crate) fn bytes(rate: u32, samples: &[f32]) -> Vec<u8> {
    let data = super::to_s16le(samples);
    let mut out = Vec::with_capacity(44 + data.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&PCM.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

pub(crate) fn write(path: &Path, rate: u32, samples: &[f32]) -> Result<(), String> {
    std::fs::write(path, bytes(rate, samples))
        .map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_written_is_read_back() {
        let samples = [0.0, 0.25, -0.25, 0.5];
        let wav = parse(&bytes(24_000, &samples)).unwrap();
        assert_eq!(wav.rate, 24_000);
        assert_eq!(wav.samples.len(), 4);
        assert!((wav.samples[1] - 0.25).abs() < 0.001);
    }

    #[test]
    fn two_channels_become_one() {
        let mut file = bytes(16_000, &[0.5, -0.5, 0.25, 0.25]);
        file[22] = 2; // channels
        file[32] = 4; // bytes per frame
        let wav = parse(&file).unwrap();
        assert_eq!(wav.samples.len(), 2);
        assert!(wav.samples[0].abs() < 0.001);
        assert!((wav.samples[1] - 0.25).abs() < 0.001);
    }

    #[test]
    fn float_files_and_odd_chunks_are_read() {
        let mut file = Vec::new();
        file.extend_from_slice(b"RIFF\0\0\0\0WAVE");
        // A chunk of odd length is padded to an even one.
        file.extend_from_slice(b"LIST\x03\0\0\0abc\0");
        file.extend_from_slice(b"fmt \x10\0\0\0");
        file.extend_from_slice(&FLOAT.to_le_bytes());
        file.extend_from_slice(&1u16.to_le_bytes());
        file.extend_from_slice(&48_000u32.to_le_bytes());
        file.extend_from_slice(&192_000u32.to_le_bytes());
        file.extend_from_slice(&4u16.to_le_bytes());
        file.extend_from_slice(&32u16.to_le_bytes());
        // A size past the end (a file written to a pipe) takes what is there.
        file.extend_from_slice(b"data\xff\xff\xff\xff");
        file.extend_from_slice(&0.75f32.to_le_bytes());
        let wav = parse(&file).unwrap();
        assert_eq!((wav.rate, wav.samples.as_slice()), (48_000, &[0.75][..]));
    }

    #[test]
    fn what_is_not_sound_is_refused_in_words() {
        assert_eq!(parse(b"hello").err().unwrap(), "not a WAV file");
        let mut file = bytes(16_000, &[0.0]);
        file[20] = 7; // µ-law
        assert!(parse(&file).err().unwrap().contains("can't be read"));
    }
}
