//! Which language a sentence is in, told from its words: no model, nothing
//! fetched. Speaking uses it to say each sentence in a voice of its own
//! language (service/speak.rs); listening, to say which language was heard.

mod detect;
mod words;
mod words_more;

pub(crate) use detect::evidence;

/// A language Dashi has a voice for. English is one tongue: which English
/// (US, UK) is the voice's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Tongue {
    English,
    Spanish,
    French,
    Hindi,
    Italian,
    Portuguese,
}

impl Tongue {
    pub(crate) const ALL: [Tongue; 6] = [
        Tongue::English,
        Tongue::Spanish,
        Tongue::French,
        Tongue::Hindi,
        Tongue::Italian,
        Tongue::Portuguese,
    ];

    /// ISO 639-1.
    pub(crate) fn code(self) -> &'static str {
        match self {
            Tongue::English => "en",
            Tongue::Spanish => "es",
            Tongue::French => "fr",
            Tongue::Hindi => "hi",
            Tongue::Italian => "it",
            Tongue::Portuguese => "pt",
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Tongue::English => "English",
            Tongue::Spanish => "Spanish",
            Tongue::French => "French",
            Tongue::Hindi => "Hindi",
            Tongue::Italian => "Italian",
            Tongue::Portuguese => "Portuguese",
        }
    }

    /// The tongue of a BCP 47 tag: "es-CO" and "ES" are Spanish.
    pub(crate) fn of(tag: &str) -> Option<Tongue> {
        let primary = tag.split(['-', '_']).next().unwrap_or("").to_lowercase();
        Tongue::ALL
            .into_iter()
            .find(|tongue| tongue.code() == primary)
    }
}

/// Each sentence's tongue, among those that may be spoken. A sentence that
/// gives no evidence ("OK.", a name, a number) keeps the tongue of the one
/// before it; the first keeps `first`, the conversation's.
pub(crate) fn tell(sentences: &[String], among: &[Tongue], first: Tongue) -> Vec<Tongue> {
    let mut last = first;
    sentences
        .iter()
        .map(|sentence| {
            if let Some(told) = evidence(sentence, among) {
                last = told;
            }
            last
        })
        .collect()
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_mixed;
