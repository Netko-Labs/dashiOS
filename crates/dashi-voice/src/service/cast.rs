//! Who says each language of one utterance: the voice asked for says its
//! own, and each other language that may be spoken has a voice paired with
//! it, so a character keeps one person's voice as far as the set allows.

use std::collections::BTreeMap;

use super::voices;
use crate::tongue::Tongue;

/// A language that may be spoken, the voice that says it, and the tag that
/// names its region when one was given ("es-CO").
struct Role {
    tongue: Tongue,
    voice: String,
    tag: Option<String>,
}

pub(crate) struct Cast {
    /// The voice asked for, first; then the others.
    roles: Vec<Role>,
}

/// The languages spoken beside the voice's own when the asker names none.
const USUAL: [Tongue; 2] = [Tongue::English, Tongue::Spanish];

fn region(tag: &str) -> Option<String> {
    tag.contains(['-', '_']).then(|| tag.to_owned())
}

impl Cast {
    /// `voices` is each other language's voice by its tag; without it, the
    /// voice's pairs in English and Spanish. `by_language` false: one voice.
    pub(crate) fn new(
        voice: &str,
        voices: Option<&BTreeMap<String, String>>,
        by_language: bool,
    ) -> Result<Self, String> {
        let own = voices::tongue(voice).ok_or(format!("There is no voice named {voice}."))?;
        let mut roles = vec![Role {
            tongue: own,
            voice: voice.to_owned(),
            tag: None,
        }];
        let Some(voices) = voices.filter(|_| by_language) else {
            let usual = USUAL.into_iter().filter(|_| by_language);
            for tongue in usual.filter(|tongue| *tongue != own) {
                if let Some(paired) = voices::pair(voice, tongue) {
                    roles.push(Role {
                        tongue,
                        voice: paired,
                        tag: None,
                    });
                }
            }
            return Ok(Self { roles });
        };
        for (tag, id) in voices {
            let tongue = Tongue::of(tag).ok_or(format!("Voice can't speak {tag}."))?;
            if voices::tongue(id) != Some(tongue) {
                return Err(format!(
                    "{id} is not a voice that speaks {}.",
                    tongue.name()
                ));
            }
            if tongue == own {
                // The voice asked for says its own language; the tag still names the region.
                roles[0].tag = region(tag);
            } else if roles.iter().all(|role| role.tongue != tongue) {
                roles.push(Role {
                    tongue,
                    voice: id.clone(),
                    tag: region(tag),
                });
            }
        }
        Ok(Self { roles })
    }

    /// The voice's own language.
    pub(crate) fn own(&self) -> Tongue {
        self.roles[0].tongue
    }

    /// The languages that may be spoken, the voice's own first.
    pub(crate) fn among(&self) -> Vec<Tongue> {
        self.roles.iter().map(|role| role.tongue).collect()
    }

    /// The voice that says `tongue`, and the tag it is read by: the role's;
    /// for a language no role has (the asker named it for this stretch
    /// alone), the pair of the voice asked for.
    pub(crate) fn says(&self, tongue: Tongue) -> Result<(String, Option<String>), String> {
        if let Some(role) = self.roles.iter().find(|role| role.tongue == tongue) {
            return Ok((role.voice.clone(), role.tag.clone()));
        }
        voices::pair(&self.roles[0].voice, tongue)
            .map(|voice| (voice, None))
            .ok_or_else(|| format!("Voice can't speak {}.", tongue.code()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tongue::Tongue::{English, French, Spanish};

    fn named(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(tag, voice)| ((*tag).to_owned(), (*voice).to_owned()))
            .collect()
    }

    #[test]
    fn a_voice_says_its_own_language_and_its_pair_the_other() {
        let cast = Cast::new("af_heart", None, true).unwrap();
        assert_eq!(cast.among(), vec![English, Spanish]);
        assert_eq!(cast.says(English).unwrap(), ("af_heart".into(), None));
        assert_eq!(cast.says(Spanish).unwrap(), ("ef_dora".into(), None));
        let cast = Cast::new("em_alex", None, true).unwrap();
        assert_eq!(cast.among(), vec![Spanish, English]);
        assert_eq!(cast.says(English).unwrap().0, "am_fenrir");
        // A language asked for by name, with no role: still the pair.
        assert_eq!(cast.says(French).unwrap().0, "ff_siwis");
    }

    #[test]
    fn the_voices_named_are_the_languages_that_may_be_spoken() {
        let voices = named(&[
            ("es-CO", "em_alex"),
            ("fr", "ff_siwis"),
            ("en", "bm_george"),
        ]);
        let cast = Cast::new("af_heart", Some(&voices), true).unwrap();
        assert_eq!(cast.among(), vec![English, Spanish, French]);
        assert_eq!(
            cast.says(Spanish).unwrap(),
            ("em_alex".into(), Some("es-CO".into()))
        );
        // The voice asked for says its own language, whatever the list says.
        assert_eq!(cast.says(English).unwrap().0, "af_heart");
        let own = named(&[("es-MX", "ef_dora")]);
        let cast = Cast::new("ef_dora", Some(&own), true).unwrap();
        assert_eq!(cast.among(), vec![Spanish]);
        assert_eq!(cast.says(Spanish).unwrap().1.as_deref(), Some("es-MX"));
    }

    #[test]
    fn one_voice_when_told_so_and_a_wrong_pairing_is_refused() {
        let voices = named(&[("es", "ef_dora")]);
        let cast = Cast::new("af_heart", Some(&voices), false).unwrap();
        assert_eq!(cast.among(), vec![English]);
        let wrong = named(&[("es", "bm_george")]);
        assert_eq!(
            Cast::new("af_heart", Some(&wrong), true).err().as_deref(),
            Some("bm_george is not a voice that speaks Spanish.")
        );
        let unknown = named(&[("ja", "jf_alpha")]);
        assert_eq!(
            Cast::new("af_heart", Some(&unknown), true).err().as_deref(),
            Some("Voice can't speak ja.")
        );
        assert!(Cast::new("zz_nobody", None, true).is_err());
    }
}
