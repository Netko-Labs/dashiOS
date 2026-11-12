//! Whisper's vocabulary (`turbo-tokens.txt`: each token's bytes in base64 and
//! its number) and the numbers the model's file says about itself.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ort::session::Session;

/// The special tokens and sizes, from the encoder file's metadata.
pub(crate) struct Facts {
    pub(crate) bands: usize,
    pub(crate) layers: usize,
    pub(crate) context: usize,
    pub(crate) state: usize,
    pub(crate) sot: i64,
    pub(crate) eot: i64,
    pub(crate) transcribe: i64,
    pub(crate) translate: i64,
    pub(crate) no_timestamps: i64,
    pub(crate) no_speech: i64,
    pub(crate) blank: i64,
    /// Each language's code and token.
    pub(crate) languages: Vec<(String, i64)>,
}

pub(crate) fn facts(encoder: &Session) -> Result<Facts, String> {
    let metadata = encoder.metadata().map_err(|error| error.to_string())?;
    let text = |key: &str| -> Result<String, String> {
        metadata
            .custom(key)
            .ok_or_else(|| format!("the Whisper model does not say its {key}"))
    };
    let number = |key: &str| -> Result<i64, String> {
        text(key)?
            .trim()
            .parse()
            .map_err(|_| format!("the Whisper model's {key} is not a number"))
    };
    let codes = text("all_language_codes")?;
    let tokens = text("all_language_tokens")?;
    let languages = codes
        .split(',')
        .zip(tokens.split(','))
        .filter_map(|(code, token)| Some((code.trim().to_owned(), token.trim().parse().ok()?)))
        .collect();
    Ok(Facts {
        bands: number("n_mels")? as usize,
        layers: number("n_text_layer")? as usize,
        context: number("n_text_ctx")? as usize,
        state: number("n_text_state")? as usize,
        sot: number("sot")?,
        eot: number("eot")?,
        transcribe: number("transcribe")?,
        translate: number("translate")?,
        no_timestamps: number("no_timestamps")?,
        no_speech: number("no_speech")?,
        blank: number("blank_id")?,
        languages,
    })
}

/// Each token's bytes, by its number.
pub(crate) fn vocabulary(file: &str) -> Result<Vec<Vec<u8>>, String> {
    let unreadable = || "the Whisper model's vocabulary can't be read".to_owned();
    let mut tokens = Vec::new();
    for line in file.lines().filter(|line| !line.is_empty()) {
        let (bytes, id) = line.split_once(' ').ok_or_else(unreadable)?;
        let id: usize = id.trim().parse().map_err(|_| unreadable())?;
        if id != tokens.len() {
            return Err(unreadable());
        }
        // The export's last token is a lone "=", which is no bytes at all.
        tokens.push(STANDARD.decode(bytes).unwrap_or_default());
    }
    Ok(tokens)
}

/// The text tokens spell. A token past the vocabulary is a special one, and says nothing.
pub(crate) fn text(tokens: &[i64], vocabulary: &[Vec<u8>]) -> String {
    let bytes: Vec<u8> = tokens
        .iter()
        .filter_map(|token| vocabulary.get(usize::try_from(*token).ok()?))
        .flatten()
        .copied()
        .collect();
    String::from_utf8_lossy(&bytes).trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_bytes_that_join_into_words() {
        // "Hel", "lo", " w", "ö" split across two tokens, "rld".
        let file = "SGVs 0\nbG8= 1\nIHc= 2\nww== 3\ntg== 4\ncmxk 5\n";
        let vocabulary = vocabulary(file).unwrap();
        assert_eq!(text(&[0, 1, 2, 3, 4, 5], &vocabulary), "Hello wörld");
        // Special tokens are past the vocabulary: nothing.
        assert_eq!(text(&[0, 50_257, 1], &vocabulary), "Hello");
        assert!(super::vocabulary("SGVs 1\n").is_err());
        assert_eq!(super::vocabulary("= 0\n").unwrap(), vec![Vec::<u8>::new()]);
    }
}
