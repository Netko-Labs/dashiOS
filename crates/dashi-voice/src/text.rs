//! Text cut into sentences, so each can be made into sound while the one
//! before plays, and shown as a caption of its own.

/// Words before a full stop that do not end a sentence.
const SHORT: [&str; 12] = [
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
];

fn ends_sentence(character: char) -> bool {
    matches!(character, '.' | '!' | '?' | '…' | '。' | '！' | '？')
}

fn closes(character: char) -> bool {
    matches!(character, '"' | '\'' | ')' | ']' | '”' | '’' | '»')
}

/// The word that ends at `end` is an abbreviation or an initial: its stop ends nothing.
fn is_short(text: &str, end: usize) -> bool {
    let word = text[..end].rsplit(char::is_whitespace).next().unwrap_or("");
    let word = word
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    SHORT.contains(&word.as_str())
        || (word.chars().count() == 1 && word.chars().all(char::is_alphabetic))
}

/// The sentences of a text, in order, each trimmed; a line's end ends a sentence too.
pub(crate) fn sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    for line in text.lines() {
        let mut start = 0;
        let mut characters = line.char_indices().peekable();
        while let Some((at, character)) = characters.next() {
            if !ends_sentence(character) {
                continue;
            }
            let stop = character == '.';
            // Take the marks that follow: "?!", "…”".
            let mut end = at + character.len_utf8();
            while let Some((next, following)) = characters.peek().copied() {
                if !(ends_sentence(following) || closes(following)) {
                    break;
                }
                end = next + following.len_utf8();
                characters.next();
            }
            let after = line[end..].chars().next();
            if after.is_some_and(|next| !next.is_whitespace()) || (stop && is_short(line, at)) {
                continue;
            }
            push(&mut sentences, &line[start..end]);
            start = end;
        }
        push(&mut sentences, &line[start..]);
    }
    sentences
}

/// A first sentence at least this long (in characters) is said in two parts.
const LONG: usize = 60;
/// The least each part keeps.
const PART: usize = 20;

fn pauses(character: char) -> bool {
    matches!(character, ',' | ';' | ':' | '—' | '–')
}

/// Where a long sentence may be said in two parts: after its first pause (a
/// comma, a semicolon, a colon, a dash, each followed by a space) that leaves
/// both parts `PART` characters or more. None for a short sentence, or one
/// with no such pause: "1,000" and "3:15" are not pauses.
fn first_pause(sentence: &str) -> Option<usize> {
    let length = sentence.chars().count();
    if length < LONG {
        return None;
    }
    let mut characters = sentence.char_indices().enumerate().peekable();
    while let Some((count, (at, character))) = characters.next() {
        let spaced = characters
            .peek()
            .is_some_and(|(_, (_, next))| next.is_whitespace());
        // `before` characters up to and with the mark, the rest after it.
        let before = count + 1;
        if pauses(character) && spaced && before >= PART && length - before >= PART {
            return Some(at + character.len_utf8());
        }
    }
    None
}

/// What is said, piece by piece: the sentences of `text`, the first of them
/// in two parts when it is long and has a pause to cut at. The first sound
/// waits for the first piece to be made whole, so a long opening sentence is
/// not made whole before any of it is heard.
pub(crate) fn pieces(text: &str) -> Vec<String> {
    let mut pieces = sentences(text);
    if let Some(cut) = pieces.first().and_then(|first| first_pause(first)) {
        let rest = pieces[0].split_off(cut);
        pieces.insert(1, rest.trim().to_owned());
    }
    pieces
}

fn push(sentences: &mut Vec<String>, piece: &str) {
    let piece = piece.split_whitespace().collect::<Vec<_>>().join(" ");
    if piece.chars().any(char::is_alphanumeric) {
        sentences.push(piece);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_questions_and_lines_end_sentences() {
        assert_eq!(
            sentences("Hello there. How are you?  I'm fine!\nNew line"),
            vec!["Hello there.", "How are you?", "I'm fine!", "New line"]
        );
        assert_eq!(
            sentences("Really?! Yes… \"Stop.\" Go"),
            vec!["Really?!", "Yes…", "\"Stop.\"", "Go"]
        );
    }

    #[test]
    fn numbers_names_and_abbreviations_are_not_cut() {
        assert_eq!(
            sentences("It costs 3.50 at example.com today."),
            vec!["It costs 3.50 at example.com today."]
        );
        assert_eq!(
            sentences("Dr. Kim met Alex J. Kim, e.g. at noon."),
            vec!["Dr. Kim met Alex J. Kim, e.g. at noon."]
        );
    }

    #[test]
    fn a_long_first_sentence_is_said_in_two_parts_at_its_first_pause() {
        assert_eq!(
            pieces(
                "I can't see the weather from this computer, but I can remind you. You asked to call Alex at noon."
            ),
            vec![
                "I can't see the weather from this computer,",
                "but I can remind you.",
                "You asked to call Alex at noon."
            ]
        );
        // Only the first: the others are made while something plays.
        let later = "Okay. Tomorrow morning in Bogota looks cool and cloudy, with a chance of rain after ten.";
        assert_eq!(pieces(later), sentences(later));
    }

    #[test]
    fn a_short_sentence_or_one_without_a_pause_is_said_whole() {
        for whole in [
            "Well, that is all.",
            "Dashi is a desktop that you can talk to and that answers you out loud every time.",
            // A pause too near either end leaves a part too short to be worth it.
            "Yes, the meeting with Alex Kim moved to tomorrow at a quarter past three in the afternoon.",
            // A number's comma and a time's colon are no pause.
            "The total for this month comes to 12,500 pesos and it is due at 3:15 tomorrow afternoon.",
        ] {
            assert_eq!(pieces(whole), vec![whole], "{whole}");
        }
        assert!(pieces("").is_empty());
    }

    #[test]
    fn nothing_to_say_is_no_sentence() {
        assert!(sentences("").is_empty());
        assert!(sentences("  \n ... \n").is_empty());
        assert_eq!(sentences("  spaced   out  "), vec!["spaced out"]);
    }
}
