//! The voices: the ones the speaking models bring, which is Dashi's own, and
//! which a language gets when none is named.

use serde_json::{Value, json};

use crate::engine::kokoro::{LANGUAGES, of_voice};
use crate::models::manifest::{self, SPEAK_SET};
use crate::models::store::Store;
use crate::service::engines::primary;

/// Dashi's voice.
pub(crate) const DEFAULT: &str = "af_heart";

/// The voices in the manifest, in its order: the first of a language is that language's own.
fn ids() -> Vec<&'static str> {
    manifest::set(SPEAK_SET)
        .map(|set| {
            set.files
                .iter()
                .filter_map(|file| file.path.strip_prefix("voices/")?.strip_suffix(".bin"))
                .collect()
        })
        .unwrap_or_default()
}

/// "af_heart" is "Heart".
fn name(id: &str) -> String {
    let given = id.split_once('_').map_or(id, |(_, given)| given);
    let mut letters = given.chars();
    letters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(letters).collect()
    })
}

pub(crate) fn list(store: &Store) -> Value {
    let folder = store.set_folder(SPEAK_SET).join("voices");
    let voices: Vec<Value> = ids()
        .into_iter()
        .filter_map(|id| {
            let language = of_voice(id)?;
            Some(json!({
                "id": id,
                "name": name(id),
                "language": language.code,
                "language_name": language.name,
                "installed": folder.join(format!("{id}.bin")).is_file(),
            }))
        })
        .collect();
    json!({ "default": DEFAULT, "voices": voices })
}

/// The voice to speak with: the one named, else the language's first, else Dashi's own.
pub(crate) fn choose(voice: Option<&str>, language: Option<&str>) -> Result<String, String> {
    if let Some(voice) = voice {
        return Ok(voice.to_owned());
    }
    let Some(asked) = language else {
        return Ok(DEFAULT.to_owned());
    };
    // The region when it is one Kokoro tells apart ("en-GB"), else the language alone ("en").
    let exact = LANGUAGES
        .iter()
        .find(|known| known.code.eq_ignore_ascii_case(asked));
    let found = exact.or_else(|| {
        LANGUAGES
            .iter()
            .find(|known| primary(known.code) == primary(asked))
    });
    let language = found.ok_or_else(|| format!("Voice can't speak {asked}."))?;
    ids()
        .into_iter()
        .find(|id| id.starts_with(language.letter))
        .map(str::to_owned)
        .ok_or_else(|| format!("Voice can't speak {asked}."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_language_gets_its_first_voice() {
        assert_eq!(choose(None, None).unwrap(), "af_heart");
        assert_eq!(choose(Some("bm_george"), Some("es")).unwrap(), "bm_george");
        assert_eq!(choose(None, Some("en")).unwrap(), "af_heart");
        assert_eq!(choose(None, Some("en-GB")).unwrap(), "bf_emma");
        assert_eq!(choose(None, Some("es-MX")).unwrap(), "ef_dora");
        assert_eq!(choose(None, Some("pt")).unwrap(), "pf_dora");
        assert_eq!(
            choose(None, Some("ja")).unwrap_err(),
            "Voice can't speak ja."
        );
    }

    #[test]
    fn every_voice_is_listed_with_its_language() {
        let folder = tempfile::tempdir().unwrap();
        let listed = list(&Store::new(folder.path()));
        let voices = listed["voices"].as_array().unwrap();
        assert_eq!(voices.len(), 18);
        assert_eq!(
            voices[0],
            json!({ "id": "af_heart", "name": "Heart", "language": "en-US", "language_name": "English (US)", "installed": false })
        );
        assert_eq!(listed["default"], "af_heart");
    }
}
