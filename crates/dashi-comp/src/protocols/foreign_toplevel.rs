//! wlr-foreign-toplevel-management: the shell's view of every window (the
//! menu bar names the focused app, the Dock lists what runs; mirin's Metal
//! host speaks it for `capabilities: ["shell.toplevels"]`). It shows and acts
//! on every window, so only the shell's processes may bind it (the session
//! client and what runs under it, as for `capture`). Maximize and full screen
//! asked through it go to the shell as `zoom` and `fullscreen`: its decision.

use crate::ipc::protocol::Event;
use std::collections::HashMap;

use smithay::reexports::{
    wayland_protocols_wlr::foreign_toplevel::v1::server::{
        zwlr_foreign_toplevel_handle_v1::{self as handle_v1, ZwlrForeignToplevelHandleV1},
        zwlr_foreign_toplevel_manager_v1::{self as manager_v1, ZwlrForeignToplevelManagerV1},
    },
    wayland_server::{Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource},
};

use crate::{
    session::trust,
    state::Dashi,
    wm::{Shown, WindowId, names},
};

/// The managers bound and each window's handles in them.
#[derive(Default)]
pub(crate) struct ForeignToplevels {
    managers: Vec<ZwlrForeignToplevelManagerV1>,
    handles: HashMap<WindowId, Vec<ZwlrForeignToplevelHandleV1>>,
    /// What each window last told: title, app id, states.
    sent: HashMap<WindowId, (String, String, Vec<u32>)>,
}

pub(crate) struct GlobalData {
    /// The session client, whose process tree may bind.
    pub shell: std::sync::Arc<std::sync::atomic::AtomicI32>,
}

pub(crate) fn create_global(
    dh: &DisplayHandle,
    shell: std::sync::Arc<std::sync::atomic::AtomicI32>,
) {
    dh.create_global::<Dashi, ZwlrForeignToplevelManagerV1, GlobalData>(3, GlobalData { shell });
}

impl GlobalDispatch<ZwlrForeignToplevelManagerV1, GlobalData> for Dashi {
    fn bind(
        state: &mut Self,
        _dh: &DisplayHandle,
        _client: &Client,
        resource: New<ZwlrForeignToplevelManagerV1>,
        _data: &GlobalData,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let manager = data_init.init(resource, ());
        state.foreign.managers.push(manager.clone());
        let ids: Vec<WindowId> = state
            .windows
            .ids()
            .filter(|id| state.windows.get(*id).is_some_and(|e| e.announced))
            .collect();
        for id in ids {
            state.foreign_add_to(id, &manager);
        }
    }

    fn can_view(client: Client, data: &GlobalData) -> bool {
        trust::is_shell_client(&client, &data.shell)
    }
}

impl Dispatch<ZwlrForeignToplevelManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        manager: &ZwlrForeignToplevelManagerV1,
        request: manager_v1::Request,
        _data: &(),
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        if let manager_v1::Request::Stop = request {
            state.foreign.managers.retain(|m| m != manager);
            manager.finished();
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: wayland_backend::server::ClientId,
        manager: &ZwlrForeignToplevelManagerV1,
        _data: &(),
    ) {
        state.foreign.managers.retain(|m| m != manager);
    }
}

impl Dispatch<ZwlrForeignToplevelHandleV1, WindowId> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        _handle: &ZwlrForeignToplevelHandleV1,
        request: handle_v1::Request,
        id: &WindowId,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let id = *id;
        let result = match request {
            handle_v1::Request::Activate { .. } | handle_v1::Request::UnsetMinimized => {
                state.focus_window(id)
            }
            handle_v1::Request::Close => state.close_window(id),
            handle_v1::Request::SetMinimized => state.park_window(id, Shown::Minimized),
            handle_v1::Request::SetMaximized => {
                state.ipc.emit(Event::Zoom {
                    window: id,
                    on: true,
                });
                Ok(())
            }
            handle_v1::Request::UnsetMaximized => {
                state.ipc.emit(Event::Zoom {
                    window: id,
                    on: false,
                });
                Ok(())
            }
            handle_v1::Request::SetFullscreen { .. } => {
                state.ipc.emit(Event::Fullscreen {
                    window: id,
                    on: true,
                });
                Ok(())
            }
            handle_v1::Request::UnsetFullscreen => {
                state.ipc.emit(Event::Fullscreen {
                    window: id,
                    on: false,
                });
                Ok(())
            }
            _ => Ok(()),
        };
        if let Err(error) = result {
            tracing::debug!(%error, "a foreign-toplevel request");
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: wayland_backend::server::ClientId,
        handle: &ZwlrForeignToplevelHandleV1,
        id: &WindowId,
    ) {
        if let Some(handles) = state.foreign.handles.get_mut(id) {
            handles.retain(|h| h != handle);
        }
    }
}

impl Dashi {
    fn foreign_add_to(&mut self, id: WindowId, manager: &ZwlrForeignToplevelManagerV1) {
        let (Some(client), Ok(dh)) = (manager.client(), Ok::<_, ()>(self.display_handle.clone()))
        else {
            return;
        };
        let Ok(handle) = client.create_resource::<ZwlrForeignToplevelHandleV1, WindowId, Dashi>(
            &dh,
            manager.version(),
            id,
        ) else {
            return;
        };
        manager.toplevel(&handle);
        let (title, app_id, states) = self.foreign_facts(id);
        handle.title(title);
        handle.app_id(app_id);
        handle.state(encode(&states));
        handle.done();
        self.foreign.handles.entry(id).or_default().push(handle);
    }

    /// A window the shell now knows of: every manager gets a handle.
    pub(crate) fn foreign_opened(&mut self, id: WindowId) {
        let managers = self.foreign.managers.clone();
        for manager in &managers {
            self.foreign_add_to(id, manager);
        }
        let facts = self.foreign_facts(id);
        self.foreign.sent.insert(id, facts);
    }

    pub(crate) fn foreign_closed(&mut self, id: WindowId) {
        for handle in self.foreign.handles.remove(&id).unwrap_or_default() {
            handle.closed();
        }
        self.foreign.sent.remove(&id);
    }

    /// Tell every manager what changed about the windows (titles, focus, states).
    pub(crate) fn foreign_refresh(&mut self) {
        let ids: Vec<WindowId> = self.foreign.handles.keys().copied().collect();
        for id in ids {
            let facts = self.foreign_facts(id);
            if self.foreign.sent.get(&id) == Some(&facts) {
                continue;
            }
            let before = self.foreign.sent.insert(id, facts.clone());
            for handle in self.foreign.handles.get(&id).into_iter().flatten() {
                let (title, app_id, states) = &facts;
                if before.as_ref().is_none_or(|b| &b.0 != title) {
                    handle.title(title.clone());
                }
                if before.as_ref().is_none_or(|b| &b.1 != app_id) {
                    handle.app_id(app_id.clone());
                }
                handle.state(encode(states));
                handle.done();
            }
        }
    }

    fn foreign_facts(&self, id: WindowId) -> (String, String, Vec<u32>) {
        let Some(entry) = self.windows.get(id) else {
            return Default::default();
        };
        let (app_id, title) = names(&entry.window);
        let mut states = Vec::new();
        if entry.maximized {
            states.push(handle_v1::State::Maximized as u32);
        }
        if entry.shown == Shown::Minimized {
            states.push(handle_v1::State::Minimized as u32);
        }
        if self.is_focused(&entry.window) {
            states.push(handle_v1::State::Activated as u32);
        }
        if entry.fullscreen.is_some() {
            states.push(handle_v1::State::Fullscreen as u32);
        }
        (title, app_id, states)
    }
}

/// The protocol's state array: each state as a native-endian u32.
fn encode(states: &[u32]) -> Vec<u8> {
    states
        .iter()
        .flat_map(|state| state.to_ne_bytes())
        .collect()
}
