//! Kokoro's alphabet: the phoneme and punctuation characters the model knows
//! and each one's number, from the model's `tokenizer.json` (Kokoro-82M,
//! Apache-2.0). A character not here is left out.

/// The pad, at both ends of every sentence.
pub(crate) const PAD: i64 = 0;
/// The most tokens the model takes, pads not counted.
pub(crate) const MOST_TOKENS: usize = 510;

const TABLE: &[(char, i64)] = &[
    (';', 1),
    (':', 2),
    (',', 3),
    ('.', 4),
    ('!', 5),
    ('?', 6),
    ('—', 9),
    ('…', 10),
    ('"', 11),
    ('(', 12),
    (')', 13),
    ('“', 14),
    ('”', 15),
    (' ', 16),
    ('\u{303}', 17),
    ('ʣ', 18),
    ('ʥ', 19),
    ('ʦ', 20),
    ('ʨ', 21),
    ('ᵝ', 22),
    ('ꭧ', 23),
    ('A', 24),
    ('I', 25),
    ('O', 31),
    ('Q', 33),
    ('S', 35),
    ('T', 36),
    ('W', 39),
    ('Y', 41),
    ('ᵊ', 42),
    ('a', 43),
    ('b', 44),
    ('c', 45),
    ('d', 46),
    ('e', 47),
    ('f', 48),
    ('h', 50),
    ('i', 51),
    ('j', 52),
    ('k', 53),
    ('l', 54),
    ('m', 55),
    ('n', 56),
    ('o', 57),
    ('p', 58),
    ('q', 59),
    ('r', 60),
    ('s', 61),
    ('t', 62),
    ('u', 63),
    ('v', 64),
    ('w', 65),
    ('x', 66),
    ('y', 67),
    ('z', 68),
    ('ɑ', 69),
    ('ɐ', 70),
    ('ɒ', 71),
    ('æ', 72),
    ('β', 75),
    ('ɔ', 76),
    ('ɕ', 77),
    ('ç', 78),
    ('ɖ', 80),
    ('ð', 81),
    ('ʤ', 82),
    ('ə', 83),
    ('ɚ', 85),
    ('ɛ', 86),
    ('ɜ', 87),
    ('ɟ', 90),
    ('ɡ', 92),
    ('ɥ', 99),
    ('ɨ', 101),
    ('ɪ', 102),
    ('ʝ', 103),
    ('ɯ', 110),
    ('ɰ', 111),
    ('ŋ', 112),
    ('ɳ', 113),
    ('ɲ', 114),
    ('ɴ', 115),
    ('ø', 116),
    ('ɸ', 118),
    ('θ', 119),
    ('œ', 120),
    ('ɹ', 123),
    ('ɾ', 125),
    ('ɻ', 126),
    ('ʁ', 128),
    ('ɽ', 129),
    ('ʂ', 130),
    ('ʃ', 131),
    ('ʈ', 132),
    ('ʧ', 133),
    ('ʊ', 135),
    ('ʋ', 136),
    ('ʌ', 138),
    ('ɣ', 139),
    ('ɤ', 140),
    ('χ', 142),
    ('ʎ', 143),
    ('ʒ', 147),
    ('ʔ', 148),
    ('ˈ', 156),
    ('ˌ', 157),
    ('ː', 158),
    ('ʰ', 162),
    ('ʲ', 164),
    ('↓', 169),
    ('→', 171),
    ('↗', 172),
    ('↘', 173),
    ('ᵻ', 177),
];

/// A character's number, if the model knows it.
pub(crate) fn id(character: char) -> Option<i64> {
    TABLE
        .iter()
        .find(|(known, _)| *known == character)
        .map(|(_, id)| *id)
}

/// The punctuation Kokoro reads as a pause or a tone: kept as its own token.
pub(crate) fn is_punctuation(character: char) -> bool {
    matches!(
        character,
        ';' | ':' | ',' | '.' | '!' | '?' | '—' | '…' | '"' | '(' | ')' | '“' | '”'
    )
}

/// The numbers for a string of phonemes; what the model doesn't know is dropped.
pub(crate) fn ids(phonemes: &str) -> Vec<i64> {
    phonemes.chars().filter_map(id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_characters_have_numbers_and_others_are_dropped() {
        assert_eq!(
            ids("həlˈO, wˈɜɹld!"),
            vec![50, 83, 54, 156, 31, 3, 16, 65, 156, 87, 123, 54, 46, 5]
        );
        assert_eq!(ids("a^b-c"), vec![43, 44, 45]);
        assert!(is_punctuation('…') && !is_punctuation(' '));
    }

    #[test]
    fn no_character_is_listed_twice() {
        for (index, (character, _)) in TABLE.iter().enumerate() {
            assert!(
                TABLE[..index].iter().all(|(other, _)| other != character),
                "{character}"
            );
        }
    }
}
