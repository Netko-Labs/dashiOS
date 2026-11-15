//! The voices: the ones the speaking models bring, which is Dashi's own, and
//! which a language gets when none is named.

use serde_json::{Value, json};

use crate::engine::kokoro::{LANGUAGES, of_voice, semitones};
use crate::models::manifest::{self, SPEAK_SET};
use crate::models::store::Store;
use crate::service::engines::primary;
use crate::tongue::Tongue;

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

/// The language a voice speaks, as a tongue: `bm_george` is English.
pub(crate) fn tongue(voice: &str) -> Option<Tongue> {
    of_voice(voice).and_then(|language| Tongue::of(language.code))
}

/// Who speaks: the second letter of a voice's name, `f` a woman, `m` a man.
fn speaker(voice: &str) -> Option<char> {
    voice.chars().nth(1)
}

/// The voice of another language that goes with `voice`: of the same kind
/// of speaker (a woman's voice with a woman's), the one whose pitch is
/// nearest; where the language has none of that kind, its first. English is
/// American unless the voice is British: an accent is not chosen by pitch.
/// docs/voice.md, "A voice for each language", says how close each pair is.
pub(crate) fn pair(voice: &str, to: Tongue) -> Option<String> {
    let british = voice.starts_with('b');
    let ids: Vec<&str> = ids()
        .into_iter()
        .filter(|id| tongue(id) == Some(to))
        .filter(|id| to != Tongue::English || id.starts_with('b') == british)
        .collect();
    let apart = |id: &&str| semitones(voice, id).map_or(f32::MAX, f32::abs);
    let nearest = ids
        .iter()
        .filter(|id| speaker(id) == speaker(voice))
        .min_by(|a, b| apart(a).total_cmp(&apart(b)));
    nearest.or(ids.first()).map(|id| (*id).to_owned())
}

/// Each other language's voice for `voice`, by the language's code.
fn pairs(voice: &str) -> Value {
    let own = tongue(voice);
    let pairs: serde_json::Map<String, Value> = Tongue::ALL
        .into_iter()
        .filter(|tongue| Some(*tongue) != own)
        .filter_map(|tongue| Some((tongue.code().to_owned(), json!(pair(voice, tongue)?))))
        .collect();
    Value::Object(pairs)
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
                "pairs": pairs(id),
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
            json!({ "id": "af_heart", "name": "Heart", "language": "en-US", "language_name": "English (US)", "installed": false,
                "pairs": { "es": "ef_dora", "fr": "ff_siwis", "hi": "hf_alpha", "it": "if_sara", "pt": "pf_dora" } })
        );
        let george = voices
            .iter()
            .find(|voice| voice["id"] == "bm_george")
            .unwrap();
        assert_eq!(
            george["pairs"],
            // No man's voice in French: the language's only one.
            json!({ "es": "em_alex", "fr": "ff_siwis", "hi": "hm_omega", "it": "im_nicola", "pt": "pm_alex" })
        );
        let alex = voices
            .iter()
            .find(|voice| voice["id"] == "em_alex")
            .unwrap();
        // Of the American men's voices, Fenrir's pitch is nearest Alex's.
        assert_eq!(alex["pairs"]["en"], "am_fenrir");
        let dora = voices
            .iter()
            .find(|voice| voice["id"] == "ef_dora")
            .unwrap();
        assert_eq!(dora["pairs"]["en"], "af_heart");
        assert_eq!(listed["default"], "af_heart");
    }
}
