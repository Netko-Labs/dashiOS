//! The models: what hears (Silero VAD, Parakeet, Whisper) and what speaks
//! (Kokoro), each run by ONNX Runtime. The service uses them through the
//! traits here, so its tests need no model.

pub(crate) mod gate;
pub(crate) mod kokoro;
pub(crate) mod parakeet;
pub(crate) mod runtime;
pub(crate) mod tdt;
pub(crate) mod tensor;
pub(crate) mod vad;
pub(crate) mod whisper;

/// Speech to text.
pub(crate) trait Recognizer: Send {
    /// The words in this sound (16 kHz, one channel), in `language` (ISO
    /// 639-1) when the model must be told.
    fn transcribe(&mut self, samples: &[f32], language: Option<&str>) -> Result<String, String>;
    /// The most samples it takes at once.
    fn longest(&self) -> usize;
}

/// The words in speech of any length: cut into pieces the model can take
/// (gate.rs, at the quietest places) and joined.
pub(crate) fn transcribe(
    recognizer: &mut dyn Recognizer,
    speech: &[f32],
    language: Option<&str>,
) -> Result<String, String> {
    let mut text = Vec::new();
    for piece in gate::pieces(speech, recognizer.longest()) {
        let words = recognizer.transcribe(piece, language)?;
        if !words.is_empty() {
            text.push(words);
        }
    }
    Ok(text.join(" "))
}

/// A word that was said and when, in milliseconds from the start of its sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Word {
    pub(crate) text: String,
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
}

/// A sentence, spoken: 24 kHz, one channel.
#[derive(Debug, Default)]
pub(crate) struct Spoken {
    pub(crate) samples: Vec<f32>,
    pub(crate) words: Vec<Word>,
}

/// A sample this loud or louder is sound; under it, the hush a model puts
/// around what it says (Kokoro: a third of a second before, half a second after).
const HUSH: f32 = 0.01;

fn samples_of(ms: u64) -> usize {
    (ms * u64::from(crate::audio::SPEAK_RATE) / 1000) as usize
}

impl Spoken {
    /// Drop the hush before the first sound, but for `keep_ms` of it; the
    /// words' times move with it. A piece that is all hush is left alone.
    pub(crate) fn trim_start(&mut self, keep_ms: u64) {
        let Some(first) = self.samples.iter().position(|sample| sample.abs() >= HUSH) else {
            return;
        };
        let dropped = first.saturating_sub(samples_of(keep_ms));
        self.samples.drain(..dropped);
        let ms = dropped as u64 * 1000 / u64::from(crate::audio::SPEAK_RATE);
        for word in &mut self.words {
            word.start_ms = word.start_ms.saturating_sub(ms);
            word.end_ms = word.end_ms.saturating_sub(ms);
        }
    }

    /// Drop the hush after the last sound, but for `keep_ms` of it.
    pub(crate) fn trim_end(&mut self, keep_ms: u64) {
        let Some(last) = self.samples.iter().rposition(|sample| sample.abs() >= HUSH) else {
            return;
        };
        let kept = (last + 1 + samples_of(keep_ms)).min(self.samples.len());
        self.samples.truncate(kept);
        let ms = kept as u64 * 1000 / u64::from(crate::audio::SPEAK_RATE);
        for word in &mut self.words {
            word.start_ms = word.start_ms.min(ms);
            word.end_ms = word.end_ms.min(ms);
        }
    }
}

/// Text to speech.
pub(crate) trait Synthesizer: Send {
    /// One sentence in a voice, at a speed (1 is the voice's own).
    fn speak(&mut self, sentence: &str, voice: &str, speed: f32) -> Result<Spoken, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 300 ms of hush, 500 ms of sound, 400 ms of hush, with one word over the sound.
    fn piece() -> Spoken {
        let mut samples = vec![0.001; samples_of(300)];
        samples.extend(vec![0.3; samples_of(500)]);
        samples.extend(vec![0.0; samples_of(400)]);
        Spoken {
            samples,
            words: vec![Word {
                text: "Hello".into(),
                start_ms: 310,
                end_ms: 790,
            }],
        }
    }

    #[test]
    fn the_hush_before_the_first_sound_is_dropped_and_the_words_move_with_it() {
        let mut spoken = piece();
        spoken.trim_start(30);
        assert_eq!(spoken.samples.len(), samples_of(30 + 500 + 400));
        assert_eq!(
            (spoken.words[0].start_ms, spoken.words[0].end_ms),
            (40, 520)
        );
        // Less hush than is kept: nothing to drop.
        let mut short = piece();
        short.trim_start(400);
        assert_eq!(short.samples.len(), piece().samples.len());
        assert_eq!(short.words, piece().words);
    }

    #[test]
    fn the_hush_after_the_last_sound_is_dropped_to_a_short_pause() {
        let mut spoken = piece();
        spoken.trim_end(120);
        assert_eq!(spoken.samples.len(), samples_of(300 + 500 + 120));
        assert_eq!(spoken.words, piece().words);
    }

    #[test]
    fn a_piece_that_is_all_hush_or_all_sound_is_left_as_it_is() {
        let mut hush = Spoken {
            samples: vec![0.0; 2400],
            words: Vec::new(),
        };
        hush.trim_start(30);
        hush.trim_end(30);
        assert_eq!(hush.samples.len(), 2400);
        let mut sound = Spoken {
            samples: vec![0.25; 2400],
            words: Vec::new(),
        };
        sound.trim_start(30);
        sound.trim_end(30);
        assert_eq!(sound.samples.len(), 2400);
    }
}
