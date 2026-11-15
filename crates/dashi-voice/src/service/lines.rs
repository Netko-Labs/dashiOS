//! What one `speak` says, a line at a time: each sentence with the voice
//! that says it and the language it is read in. The asker may name the
//! language of all of it or of each stretch; where it names none, the words
//! tell (tongue/), and a sentence that tells nothing keeps the language of
//! the one before it.

use super::cast::Cast;
use super::voices;
use crate::protocol::{Speak, Stretch};
use crate::tongue::{self, Tongue};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Line {
    pub(crate) text: String,
    pub(crate) voice: String,
    /// The tag the sentence is read by ("es-CO"); none is the voice's own language.
    pub(crate) tag: Option<String>,
}

/// The tongue a stretch was said to be in.
fn named(language: &str) -> Result<Tongue, String> {
    Tongue::of(language).ok_or(format!("Voice can't speak {language}."))
}

/// The lines of a request, and whether the first two are one long sentence said in two parts.
pub(crate) fn lines(params: &Speak) -> Result<(Vec<Line>, bool), String> {
    let voice = voices::choose(params.voice.as_deref(), params.language.as_deref())?;
    let by_language = params.by_language.unwrap_or(true);
    let cast = Cast::new(&voice, params.voices.as_ref(), by_language)?;
    let whole = [Stretch {
        text: params.text.clone(),
        language: params.language.clone(),
    }];
    let stretches = params.parts.as_deref().unwrap_or(&whole);
    let among = cast.among();
    let hinted = params.hint.as_deref().and_then(Tongue::of);
    let mut last = hinted
        .filter(|hint| among.contains(hint))
        .unwrap_or(cast.own());
    let mut lines = Vec::new();
    for stretch in stretches {
        let sentences = crate::text::sentences(&stretch.text);
        let told = match stretch.language.as_deref() {
            // One voice: its own language, whatever was named.
            _ if !by_language => vec![cast.own(); sentences.len()],
            Some(language) => vec![named(language)?; sentences.len()],
            None => tongue::tell(&sentences, &among, last),
        };
        last = told.last().copied().unwrap_or(last);
        for (text, tongue) in sentences.into_iter().zip(told) {
            let (voice, tag) = cast.says(tongue)?;
            // The stretch's own tag names the region ("es-CO"), when it has one.
            let own = stretch.language.as_deref().filter(|tag| {
                by_language && tag.contains(['-', '_']) && Tongue::of(tag) == Some(tongue)
            });
            let tag = own.map(str::to_owned).or(tag);
            lines.push(Line { text, voice, tag });
        }
    }
    let halves = lines
        .first()
        .and_then(|line| crate::text::halves(&line.text));
    let cut = halves.is_some();
    if let Some((first, rest)) = halves {
        let mut second = lines[0].clone();
        lines[0].text = first;
        second.text = rest;
        lines.insert(1, second);
    }
    Ok((lines, cut))
}

#[cfg(test)]
#[path = "lines_tests.rs"]
mod tests;
