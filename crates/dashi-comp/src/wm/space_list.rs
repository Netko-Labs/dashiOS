//! Adding and removing Spaces (`space-add`, `space-remove`); spaces.rs keeps
//! the rest: which Space each window is on, and switching between them. A
//! Space can be added at an index (the shell puts a full-screen window's
//! Desktop beside the one it came from): the Spaces from there move up one.

use serde_json::{Value, json};

use super::{spaces::MAX_SPACES, windows::WindowId};
use crate::state::Dashi;

impl Dashi {
    /// `space-add {at?}`: a new Space at the end, or at index `at`; the
    /// Spaces from `at` on move up one (their windows with them, and what
    /// shows, and a slide under way).
    pub(crate) fn add_space(&mut self, at: Option<usize>) -> Result<Value, String> {
        if self.spaces.count >= MAX_SPACES {
            return Err(format!("there are already {MAX_SPACES} Spaces"));
        }
        let at = at.unwrap_or(self.spaces.count);
        if at > self.spaces.count {
            return Err(format!("`at` must be 0–{}", self.spaces.count));
        }
        let mut previous = self.spaces.current;
        let ids: Vec<WindowId> = self.windows.ids().collect();
        for id in &ids {
            if let Some(entry) = self.windows.get_mut(*id)
                && entry.space >= at
            {
                entry.space += 1;
                if entry.announced {
                    let space = entry.space;
                    self.ipc
                        .emit("window-space", json!({ "window": id, "space": space }));
                }
            }
        }
        let shift = |index: &mut usize| {
            if *index >= at {
                *index += 1;
            }
        };
        shift(&mut self.spaces.current);
        shift(&mut previous);
        if let Some(slide) = self.spaces.slide.as_mut() {
            shift(&mut slide.from);
            shift(&mut slide.to);
        }
        self.spaces.count += 1;
        self.emit_space(previous);
        let mut answer = self.spaces.answer();
        answer["space"] = json!(at);
        Ok(answer)
    }

    /// `space-remove {space}`: its windows go to the Space on its left (the
    /// first's to the second), and the Spaces after it move down one. Shown,
    /// it gives way to the Space that takes its windows first.
    pub(crate) fn remove_space(&mut self, space: usize) -> Result<Value, String> {
        if space >= self.spaces.count {
            return Err(format!("no Space {space}"));
        }
        if self.spaces.count <= 1 {
            return Err("the last Space stays".into());
        }
        let into = if space == 0 { 1 } else { space - 1 };
        let previous = self.spaces.current;
        if self.spaces.current == space {
            self.spaces.slide = None;
            self.switch_space_now(into);
        }
        let ids: Vec<WindowId> = self.windows.ids().collect();
        for id in &ids {
            if self.windows.get(*id).is_some_and(|e| e.space == space)
                && self.move_to_space(*id, into).is_err()
                && let Some(entry) = self.windows.get_mut(*id)
            {
                // Not announced yet: it just belongs there.
                entry.space = into;
            }
        }
        // Renumber: the Spaces after it move down one, and so does what is shown.
        for id in &ids {
            if let Some(entry) = self.windows.get_mut(*id)
                && entry.space > space
            {
                entry.space -= 1;
                let space = entry.space;
                self.ipc
                    .emit("window-space", json!({ "window": id, "space": space }));
            }
        }
        if self.spaces.current > space {
            self.spaces.current -= 1;
        }
        self.spaces.count -= 1;
        self.emit_space(previous.min(self.spaces.count - 1));
        Ok(self.spaces.answer())
    }
}
