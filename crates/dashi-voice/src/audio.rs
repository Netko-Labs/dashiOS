//! Sound in and out through PipeWire's own programs: `pw-record` for the
//! microphone and `pw-play` for the speaker (PipeWire, MIT), raw 32-bit float
//! mono on a pipe. They run only while Dashi listens or speaks, so the
//! microphone is open only then, and PipeWire's own indicators say so.

use std::{
    io::{self, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::Sender,
    thread,
};

/// The microphone's rate: what Silero and Parakeet take.
pub(crate) const LISTEN_RATE: u32 = 16_000;
/// Kokoro's rate.
pub(crate) const SPEAK_RATE: u32 = 24_000;

/// The microphone, open until dropped.
pub(crate) struct Capture {
    child: Child,
}

impl Capture {
    /// Start `pw-record`; each chunk of samples is sent as `wrap(samples)`.
    /// The sender is dropped (and the receiver sees nothing more) when it ends.
    pub(crate) fn start<T: Send + 'static>(
        sender: Sender<T>,
        wrap: impl Fn(Vec<f32>) -> T + Send + 'static,
    ) -> io::Result<Self> {
        let mut child = Command::new("pw-record")
            .args([
                "--raw",
                "--rate",
                "16000",
                "--channels",
                "1",
                "--format",
                "f32",
            ])
            .args(["--latency", "32ms", "--media-role", "Communication"])
            .args([
                "-P",
                "{ media.name = \"Dashi is listening\" node.name = \"dashi-voice-in\" }",
            ])
            .arg("-")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("pw-record has no stdout"))?;
        thread::Builder::new()
            .name("capture".into())
            .spawn(move || {
                let mut bytes = vec![0u8; 512 * 4];
                loop {
                    match stdout.read(&mut bytes) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            let samples = f32_from_le(&bytes[..count - count % 4]);
                            if sender.send(wrap(samples)).is_err() {
                                break;
                            }
                        }
                    }
                }
            })?;
        Ok(Self { child })
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        // Our own child, by its handle: never a process found by name.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The speaker: one `pw-play` per utterance, fed as Dashi synthesizes.
pub(crate) struct Playback {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Playback {
    pub(crate) fn start() -> io::Result<Self> {
        let mut child = Command::new("pw-play")
            .args([
                "--raw",
                "--rate",
                "24000",
                "--channels",
                "1",
                "--format",
                "f32",
            ])
            .args(["--latency", "60ms", "--media-role", "Communication"])
            .args([
                "-P",
                "{ media.name = \"Dashi is speaking\" node.name = \"dashi-voice-out\" }",
            ])
            .arg("-")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take();
        Ok(Self { child, stdin })
    }

    /// The child's id, so another thread can stop it (`stop_child`).
    pub(crate) fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Blocks while the pipe is full, so it paces with what is heard.
    pub(crate) fn write(&mut self, samples: &[f32]) -> io::Result<()> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| io::Error::other("playback closed"))?;
        // Small pieces, so a stop lands within a fraction of a second.
        for piece in samples.chunks(2_400) {
            stdin.write_all(&f32_to_le(piece))?;
        }
        Ok(())
    }

    /// Let it play out, unless `stopped` says otherwise first; whether it was stopped.
    pub(crate) fn finish_unless(mut self, stopped: impl Fn() -> bool) -> bool {
        drop(self.stdin.take());
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) | Err(_) => return false,
                Ok(None) if stopped() => {
                    let _ = self.child.kill();
                    return true;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
    }
}

impl Drop for Playback {
    fn drop(&mut self) {
        // Our own child, by its handle: stopped if it is still playing.
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

/// Stop a playback from another thread: SIGTERM to that child's exact pid.
pub(crate) fn stop_child(pid: u32) {
    let Ok(pid) = i32::try_from(pid) else { return };
    // SAFETY: kill(2) with a pid we spawned and have not yet reaped (the
    // Playback that owns it waits on it after this), so it is still ours.
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
}

pub(crate) fn f32_from_le(bytes: &[u8]) -> Vec<f32> {
    let (chunks, _) = bytes.as_chunks::<4>();
    chunks.iter().map(|&b| f32::from_le_bytes(b)).collect()
}

pub(crate) fn f32_to_le(samples: &[f32]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

/// How loud a chunk is, 0 to 1, for the menu bar's waveform.
pub(crate) fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    // Speech sits around -30..-10 dBFS: spread that over the bar.
    let db = 20.0 * rms.max(1e-6).log10();
    ((db + 50.0) / 45.0).clamp(0.0, 1.0)
}

/// Resample by linear interpolation (for a WAV file at another rate).
pub(crate) fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = f64::from(from) / f64::from(to);
    let count = (samples.len() as f64 / ratio).floor() as usize;
    (0..count)
        .map(|index| {
            let position = index as f64 * ratio;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (position - left as f64) as f32;
            samples[left] * (1.0 - fraction) + samples[right] * fraction
        })
        .collect()
}

/// A WAV file's samples (PCM 16-bit or float 32-bit, any channels, mixed to mono) and rate.
pub(crate) fn read_wav(path: &Path) -> io::Result<(Vec<f32>, u32)> {
    let bytes = std::fs::read(path)?;
    parse_wav(&bytes).map_err(io::Error::other)
}

pub(crate) fn parse_wav(bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let mut at = 12;
    let mut format: Option<(u16, u16, u32, u16)> = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
            as usize;
        let body = &bytes[at + 8..(at + 8 + size).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            let u16_at = |i: usize| u16::from_le_bytes([body[i], body[i + 1]]);
            let rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            format = Some((u16_at(0), u16_at(2), rate, u16_at(14)));
        } else if id == b"data" {
            let (kind, channels, rate, bits) = format.ok_or("data before fmt")?;
            let channels = usize::from(channels.max(1));
            let frames: Vec<f32> = match (kind, bits) {
                (1, 16) => body
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|&b| f32::from(i16::from_le_bytes(b)) / 32768.0)
                    .collect(),
                (3, 32) => f32_from_le(body),
                _ => return Err(format!("unsupported WAV format {kind} at {bits} bits")),
            };
            let mono = frames
                .chunks_exact(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect();
            return Ok((mono, rate));
        }
        at += 8 + size + size % 2;
    }
    Err("no data in the WAV file".into())
}

/// 16-bit PCM mono WAV bytes.
pub(crate) fn wav_bytes(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_round_trip() {
        let samples = vec![0.0, 0.5, -0.5, 0.25];
        let (back, rate) = parse_wav(&wav_bytes(&samples, 16_000)).unwrap();
        assert_eq!(rate, 16_000);
        for (a, b) in samples.iter().zip(&back) {
            assert!((a - b).abs() < 1e-3);
        }
    }

    #[test]
    fn not_a_wav() {
        assert!(parse_wav(b"hello").is_err());
    }

    #[test]
    fn resample_halves() {
        let out = resample(&[0.0, 1.0, 2.0, 3.0], 32_000, 16_000);
        assert_eq!(out, vec![0.0, 2.0]);
    }

    #[test]
    fn level_is_zero_for_silence_and_high_for_loud() {
        assert_eq!(level(&[0.0; 100]), 0.0);
        assert!(level(&[0.3; 100]) > 0.8);
    }
}
