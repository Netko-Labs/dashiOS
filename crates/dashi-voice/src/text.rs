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
    fn nothing_to_say_is_no_sentence() {
        assert!(sentences("").is_empty());
        assert!(sentences("  \n ... \n").is_empty());
        assert_eq!(sentences("  spaced   out  "), vec!["spaced out"]);
    }
}
