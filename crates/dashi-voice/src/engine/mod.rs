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

/// Text to speech.
pub(crate) trait Synthesizer: Send {
    /// One sentence in a voice, at a speed (1 is the voice's own).
    fn speak(&mut self, sentence: &str, voice: &str, speed: f32) -> Result<Spoken, String>;
}
