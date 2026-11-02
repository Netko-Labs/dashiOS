//! ext-foreign-toplevel-list: the windows, listed read-only (title and app
//! id), for capture pickers (xdg-desktop-portal's window sharing names a
//! window through it to ext-image-copy-capture). Shown to whoever may copy
//! the screen (protocols/screencopy.rs grants), never in greeter mode.

use std::collections::HashMap;

use smithay::wayland::foreign_toplevel_list::{
    ForeignToplevelHandle, ForeignToplevelListHandler, ForeignToplevelListState,
};

use crate::{
    protocols::screencopy::{Grants, may_copy},
    state::Dashi,
    wm::{WindowId, names},
};

/// The list's state, and each listed window's handle.
pub(crate) struct ToplevelList {
    state: ForeignToplevelListState,
    handles: HashMap<WindowId, (ForeignToplevelHandle, String, String)>,
}

impl ToplevelList {
    pub(crate) fn new(
        dh: &smithay::reexports::wayland_server::DisplayHandle,
        grants: Grants,
    ) -> Self {
        let state = ForeignToplevelListState::new_with_filter::<Dashi>(dh, move |client| {
            may_copy(client, &grants)
        });
        Self {
            state,
            handles: HashMap::new(),
        }
    }

    /// The window a client's handle names.
    pub(crate) fn window_of(&self, handle: &ForeignToplevelHandle) -> Option<WindowId> {
        self.handles
            .iter()
            .find(|(_, (listed, _, _))| listed.identifier() == handle.identifier())
            .map(|(id, _)| *id)
    }
}

impl Dashi {
    /// Keep the list in step with the announced windows (after every dispatch).
    pub(crate) fn toplevel_list_refresh(&mut self) {
        let Some(list) = self.toplevel_list.as_mut() else {
            return;
        };
        let windows: Vec<(WindowId, String, String)> = self
            .windows
            .entries()
            .filter(|entry| entry.announced)
            .map(|entry| {
                let (app_id, title) = names(&entry.window);
                (entry.id, title, app_id)
            })
            .collect();
        let gone: Vec<WindowId> = list
            .handles
            .keys()
            .filter(|id| !windows.iter().any(|(w, _, _)| w == *id))
            .copied()
            .collect();
        for id in gone {
            if let Some((handle, _, _)) = list.handles.remove(&id) {
                list.state.remove_toplevel(&handle);
            }
        }
        for (id, title, app_id) in windows {
            match list.handles.get_mut(&id) {
                None => {
                    let handle = list.state.new_toplevel::<Dashi>(&title, &app_id);
                    list.handles.insert(id, (handle, title, app_id));
                }
                Some((handle, sent_title, sent_app_id)) => {
                    if *sent_title == title && *sent_app_id == app_id {
                        continue;
                    }
                    if *sent_title != title {
                        handle.send_title(&title);
                    }
                    if *sent_app_id != app_id {
                        handle.send_app_id(&app_id);
                    }
                    handle.send_done();
                    *sent_title = title;
                    *sent_app_id = app_id;
                }
            }
        }
    }
}

impl ForeignToplevelListHandler for Dashi {
    fn foreign_toplevel_list_state(&mut self) -> &mut ForeignToplevelListState {
        match self.toplevel_list.as_mut() {
            Some(list) => &mut list.state,
            None => unreachable!("ext-foreign-toplevel-list has no global in greeter mode"),
        }
    }
}

smithay::delegate_foreign_toplevel_list!(Dashi);
