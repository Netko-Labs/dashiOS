//! Snippets' keywords, watched as the person types (IPC `snippets`): when
//! what was just typed into a window ends with one, the shell hears the
//! keyword (`snippet` event) and decides whether to expand it; it asks back
//! with `snippet-erase`, which deletes the keyword only if it is still the
//! last thing typed there. Mechanism only: which keywords, which apps, and
//! what the keyword becomes are the shell's.
//!
//! What is typed is never sent anywhere. The tail kept is as long as the
//! longest keyword, and only while the shell has given keywords; it starts
//! over on anything that moves the caret or the focus (a click, an arrow, a
//! chord, another window).

use std::collections::VecDeque;

use super::{
    keymap::{Chord, Mods},
    keysyms::KeyInfo,
};
use crate::{ipc::protocol::Event, state::Dashi};

/// At most this many keywords.
pub(crate) const MAX_KEYWORDS: usize = 256;
/// A keyword is this many characters, at most.
pub(crate) const MAX_KEYWORD_CHARS: usize = 32;
/// And at least this many: one letter alone would fire by accident.
const MIN_KEYWORD_CHARS: usize = 2;

#[derive(Default)]
pub(crate) struct Snippets {
    keywords: Vec<Vec<char>>,
    longest: usize,
    /// The window typed into, and its last characters (at most `longest`).
    window: Option<u64>,
    typed: VecDeque<char>,
}

impl Snippets {
    /// The shell's keywords, checked: 2 to 32 characters, no spaces or control characters.
    pub(crate) fn set(&mut self, keywords: &[String]) -> Result<(), String> {
        if keywords.len() > MAX_KEYWORDS {
            return Err(format!("at most {MAX_KEYWORDS} keywords"));
        }
        let mut parsed = Vec::with_capacity(keywords.len());
        for keyword in keywords {
            let chars: Vec<char> = keyword.chars().collect();
            if chars.len() < MIN_KEYWORD_CHARS || chars.len() > MAX_KEYWORD_CHARS {
                return Err(format!(
                    "a keyword is {MIN_KEYWORD_CHARS} to {MAX_KEYWORD_CHARS} characters: {keyword:?}"
                ));
            }
            if chars.iter().any(|c| c.is_whitespace() || c.is_control()) {
                return Err(format!(
                    "a keyword has no spaces or control characters: {keyword:?}"
                ));
            }
            parsed.push(chars);
        }
        self.longest = parsed.iter().map(Vec::len).max().unwrap_or(0);
        self.keywords = parsed;
        self.reset();
        Ok(())
    }

    pub(crate) fn is_watching(&self) -> bool {
        !self.keywords.is_empty()
    }

    /// Forget what was typed: the caret or the focus moved.
    pub(crate) fn reset(&mut self) {
        self.window = None;
        self.typed.clear();
    }

    /// `text` was typed into `window`; the keyword it completes, if one.
    pub(crate) fn typed(&mut self, window: u64, text: &str) -> Option<String> {
        if !self.is_watching() {
            return None;
        }
        if self.window != Some(window) {
            self.reset();
            self.window = Some(window);
        }
        for c in text.chars() {
            self.typed.push_back(c);
            while self.typed.len() > self.longest {
                self.typed.pop_front();
            }
        }
        // The longest that matches: ";addr2" over ";addr" when both end here.
        self.keywords
            .iter()
            .filter(|keyword| self.ends_with(keyword))
            .max_by_key(|keyword| keyword.len())
            .map(|keyword| keyword.iter().collect())
    }

    /// BackSpace in `window`: the last character typed is gone.
    pub(crate) fn erased(&mut self, window: u64) {
        if self.window == Some(window) {
            self.typed.pop_back();
        } else {
            self.reset();
        }
    }

    /// Whether `keyword` is still the last thing typed into `window`.
    pub(crate) fn ends_with_in(&self, window: u64, keyword: &str) -> bool {
        let chars: Vec<char> = keyword.chars().collect();
        self.window == Some(window) && !chars.is_empty() && self.ends_with(&chars)
    }

    fn ends_with(&self, keyword: &[char]) -> bool {
        keyword.len() <= self.typed.len()
            && self
                .typed
                .iter()
                .rev()
                .zip(keyword.iter().rev())
                .all(|(a, b)| a == b)
    }
}

impl Dashi {
    /// A key that reached a window as it is: what it typed, for the snippets' keywords.
    pub(super) fn watch_snippets(&mut self, info: &KeyInfo, mods: Mods) {
        if !self.keys.snippets.is_watching() {
            return;
        }
        let Some(window) = self.focused_window_id() else {
            return self.keys.snippets.reset();
        };
        let plain = !mods.super_ && !mods.ctrl && !mods.alt;
        let name = info.names.first().map(String::as_str).unwrap_or_default();
        match (&info.text, plain) {
            (Some(text), true) => {
                if let Some(keyword) = self.keys.snippets.typed(window, text) {
                    let keyword = keyword.clone();
                    self.ipc.emit(Event::Snippet { keyword, window });
                }
            }
            (None, true) if name == "BackSpace" => self.keys.snippets.erased(window),
            _ => self.keys.snippets.reset(),
        }
    }

    /// `snippet-erase`: delete `keyword` from `window`, if it is still the last thing typed there.
    pub(crate) fn erase_snippet(&mut self, window: u64, keyword: &str) -> Result<(), String> {
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        if self.focused_window_id() != Some(window)
            || !self.keys.snippets.ends_with_in(window, keyword)
        {
            return Err("the keyword is no longer the last thing typed there".into());
        }
        let backspace = Chord::parse("BackSpace")?;
        let time = self.start_time.elapsed().as_millis() as u32;
        for _ in keyword.chars() {
            if !self.tap(&backspace, None, false, time) {
                return Err("BackSpace cannot be typed on this keyboard".into());
            }
        }
        self.keys.snippets.reset();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn watching(keywords: &[&str]) -> Snippets {
        let mut snippets = Snippets::default();
        let keywords: Vec<String> = keywords.iter().map(|k| k.to_string()).collect();
        snippets.set(&keywords).unwrap();
        snippets
    }

    fn type_all(snippets: &mut Snippets, window: u64, text: &str) -> Option<String> {
        let mut last = None;
        for c in text.chars() {
            last = snippets.typed(window, &c.to_string());
        }
        last
    }

    #[test]
    fn a_keyword_fires_once_it_is_typed_whole() {
        let mut snippets = watching(&[";addr", ";sig"]);
        assert_eq!(type_all(&mut snippets, 1, "my ;add"), None);
        assert_eq!(snippets.typed(1, "r").as_deref(), Some(";addr"));
        assert!(snippets.ends_with_in(1, ";addr"));
        assert!(!snippets.ends_with_in(2, ";addr"));
    }

    #[test]
    fn the_longest_keyword_that_ends_here_wins() {
        let mut snippets = watching(&[";a", ";ab"]);
        assert_eq!(snippets.typed(1, ";").as_deref(), None);
        // A keyword that begins another fires first; the shell keeps them apart (no keyword starts another).
        assert_eq!(snippets.typed(1, "a").as_deref(), Some(";a"));
        assert_eq!(snippets.typed(1, "b").as_deref(), Some(";ab"));
        let mut snippets = watching(&["ab", "xab"]);
        assert_eq!(type_all(&mut snippets, 1, "xab").as_deref(), Some("xab"));
    }

    #[test]
    fn another_window_backspace_and_reset_start_over() {
        let mut snippets = watching(&[";addr"]);
        type_all(&mut snippets, 1, ";ad");
        assert_eq!(type_all(&mut snippets, 2, "dr"), None);
        type_all(&mut snippets, 1, ";adx");
        snippets.erased(1);
        assert_eq!(snippets.typed(1, "d"), None);
        assert_eq!(snippets.typed(1, "r").as_deref(), Some(";addr"));
        snippets.reset();
        assert!(!snippets.ends_with_in(1, ";addr"));
    }

    #[test]
    fn nothing_is_kept_without_keywords_and_bad_keywords_are_refused() {
        let mut snippets = Snippets::default();
        assert_eq!(snippets.typed(1, "a"), None);
        assert!(snippets.typed.is_empty());
        assert!(snippets.set(&["a".into()]).is_err());
        assert!(snippets.set(&["a b".into()]).is_err());
        assert!(snippets.set(&["x".repeat(33)]).is_err());
        assert!(snippets.set(&[";é✓".into()]).is_ok());
        assert_eq!(snippets.typed(1, ";"), None);
        assert_eq!(snippets.typed(1, "é"), None);
        assert_eq!(snippets.typed(1, "✓").as_deref(), Some(";é✓"));
    }

    #[test]
    fn only_the_tail_is_kept() {
        let mut snippets = watching(&[";ab"]);
        type_all(&mut snippets, 1, "a long sentence typed before");
        assert!(snippets.typed.len() <= 3);
    }
}
