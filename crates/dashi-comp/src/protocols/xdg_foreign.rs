//! xdg-foreign-unstable-v2: an app exports its window as a handle, and
//! another client (a portal's dialog) imports it to be that window's child.
//! smithay has this protocol, but keeps the handles private; Dashi also
//! needs to look a handle up, so the shell can attach a portal's dialog to
//! the window a `wayland:HANDLE` names (IPC `window-for-handle`). Ported from
//! smithay 0.7's `wayland::xdg_foreign` (MIT), with that lookup added.
//!
//! A handle is a capability: it is 32 random characters, and it stops naming
//! anything once its exporter destroys it.

use std::{collections::HashMap, io};

use smithay::{
    reexports::{
        wayland_protocols::xdg::foreign::zv2::server::{
            zxdg_exported_v2::{self, ZxdgExportedV2},
            zxdg_exporter_v2::{self, ZxdgExporterV2},
            zxdg_imported_v2::{self, ZxdgImportedV2},
            zxdg_importer_v2::{self, ZxdgImporterV2},
        },
        wayland_server::{
            Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
            backend::ClientId, protocol::wl_surface::WlSurface,
        },
    },
    wayland::{
        compositor,
        shell::{
            is_valid_parent,
            xdg::{XdgShellHandler, XdgToplevelSurfaceData},
        },
    },
};

use crate::state::Dashi;

const HANDLE_LENGTH: usize = 32;
const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

struct Exported {
    surface: WlSurface,
    /// The child an importer set (one at a time, as the protocol has it).
    child: Option<(WlSurface, ZxdgImportedV2)>,
}

/// The exported toplevels, by handle.
#[derive(Default)]
pub(crate) struct ForeignExports {
    exported: HashMap<String, Exported>,
}

impl ForeignExports {
    /// The toplevel surface a handle names, while its exporter keeps it exported.
    pub(crate) fn surface_for(&self, handle: &str) -> Option<&WlSurface> {
        self.exported.get(handle).map(|exported| &exported.surface)
    }
}

/// A fresh handle from the kernel's randomness, or why there is none.
fn new_handle() -> io::Result<String> {
    let mut bytes = [0u8; HANDLE_LENGTH];
    fill(&mut bytes, getrandom)?;
    Ok(bytes
        .iter()
        .map(|byte| ALPHABET[*byte as usize % ALPHABET.len()] as char)
        .collect())
}

/// Fills `bytes` from `read`: a short or interrupted read is retried; any
/// other failure, or a read of nothing, gives up, so a broken source never
/// spins the event loop.
fn fill(bytes: &mut [u8], mut read: impl FnMut(&mut [u8]) -> io::Result<usize>) -> io::Result<()> {
    let mut filled = 0;
    while filled < bytes.len() {
        match read(&mut bytes[filled..]) {
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(got) => filled += got,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn getrandom(buffer: &mut [u8]) -> io::Result<usize> {
    // SAFETY: `buffer` is a valid, writable buffer of `buffer.len()` bytes for the whole call.
    let got = unsafe { libc::getrandom(buffer.as_mut_ptr().cast(), buffer.len(), 0) };
    usize::try_from(got).map_err(|_| io::Error::last_os_error())
}

pub(crate) fn create_globals(dh: &DisplayHandle) {
    dh.create_global::<Dashi, ZxdgExporterV2, ()>(1, ());
    dh.create_global::<Dashi, ZxdgImporterV2, ()>(1, ());
}

pub(crate) struct ExportedData {
    handle: String,
}

pub(crate) struct ImportedData {
    handle: String,
}

impl GlobalDispatch<ZxdgExporterV2, ()> for Dashi {
    fn bind(
        _state: &mut Self,
        _dh: &DisplayHandle,
        _client: &Client,
        resource: New<ZxdgExporterV2>,
        _global_data: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<ZxdgExporterV2, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        resource: &ZxdgExporterV2,
        request: zxdg_exporter_v2::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let zxdg_exporter_v2::Request::ExportToplevel { id, surface } = request {
            let handle = match new_handle() {
                Ok(handle) => handle,
                Err(error) => {
                    // No handle can be made: the export fails instead of waiting forever.
                    tracing::warn!(%error, "xdg-foreign: no randomness for a handle");
                    data_init.init(
                        id,
                        ExportedData {
                            handle: String::new(),
                        },
                    );
                    resource.post_error(
                        zxdg_exporter_v2::Error::InvalidSurface,
                        "the compositor could not make a handle",
                    );
                    return;
                }
            };
            let exported = data_init.init(
                id,
                ExportedData {
                    handle: handle.clone(),
                },
            );
            exported.handle(handle.clone());
            state.xdg_foreign.exported.insert(
                handle,
                Exported {
                    surface,
                    child: None,
                },
            );
        }
    }
}

impl Dispatch<ZxdgExportedV2, ExportedData> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        _resource: &ZxdgExportedV2,
        _request: zxdg_exported_v2::Request,
        _data: &ExportedData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
    }

    fn destroyed(
        state: &mut Self,
        _client: ClientId,
        _resource: &ZxdgExportedV2,
        data: &ExportedData,
    ) {
        unparent(state, &data.handle, None);
        state.xdg_foreign.exported.remove(&data.handle);
    }
}

impl GlobalDispatch<ZxdgImporterV2, ()> for Dashi {
    fn bind(
        _state: &mut Self,
        _dh: &DisplayHandle,
        _client: &Client,
        resource: New<ZxdgImporterV2>,
        _global_data: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<ZxdgImporterV2, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        _resource: &ZxdgImporterV2,
        request: zxdg_importer_v2::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let zxdg_importer_v2::Request::ImportToplevel { id, handle } = request {
            let known = state.xdg_foreign.exported.contains_key(&handle);
            let imported = data_init.init(id, ImportedData { handle });
            if !known {
                imported.destroyed();
            }
        }
    }
}

impl Dispatch<ZxdgImportedV2, ImportedData> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        resource: &ZxdgImportedV2,
        request: zxdg_imported_v2::Request,
        data: &ImportedData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let zxdg_imported_v2::Request::SetParentOf { surface: child } = request else {
            return;
        };
        let Some(exported) = state.xdg_foreign.exported.get_mut(&data.handle) else {
            return;
        };
        let parent = exported.surface.clone();
        let mut invalid = false;
        let mut changed = false;
        compositor::with_states(&child, |states| {
            if let Some(role) = states.data_map.get::<XdgToplevelSurfaceData>() {
                if is_valid_parent(&child, &parent) {
                    if let Ok(mut role) = role.lock() {
                        changed = role.parent.as_ref() != Some(&parent);
                        role.parent = Some(parent.clone());
                    }
                } else {
                    invalid = true;
                }
            }
        });
        if invalid {
            resource.post_error(
                zxdg_imported_v2::Error::InvalidSurface,
                "invalid parent relationship",
            );
            return;
        }
        exported.child = Some((child.clone(), resource.clone()));
        if changed {
            parent_changed(state, &child);
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: ClientId,
        resource: &ZxdgImportedV2,
        data: &ImportedData,
    ) {
        unparent(state, &data.handle, Some(resource));
    }
}

/// The child a handle's importer set loses that parent (all importers' when `by` is None).
fn unparent(state: &mut Dashi, handle: &str, by: Option<&ZxdgImportedV2>) {
    let Some(exported) = state.xdg_foreign.exported.get_mut(handle) else {
        return;
    };
    let Some((child, importer)) = exported.child.as_ref() else {
        return;
    };
    if by.is_some_and(|by| by != importer) {
        return;
    }
    let parent = exported.surface.clone();
    let child = child.clone();
    exported.child = None;
    let mut changed = false;
    compositor::with_states(&child, |states| {
        if let Some(role) = states.data_map.get::<XdgToplevelSurfaceData>()
            && let Ok(mut role) = role.lock()
            && role.parent.as_ref() == Some(&parent)
        {
            role.parent = None;
            changed = true;
        }
    });
    if changed {
        parent_changed(state, &child);
    }
}

fn parent_changed(state: &mut Dashi, child: &WlSurface) {
    let toplevel = state
        .xdg_shell_state
        .toplevel_surfaces()
        .iter()
        .find(|toplevel| toplevel.wl_surface() == child)
        .cloned();
    if let Some(toplevel) = toplevel {
        XdgShellHandler::parent_changed(state, toplevel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_source_gives_up_instead_of_spinning() {
        let mut bytes = [0u8; 8];
        let mut calls = 0;
        let result = fill(&mut bytes, |_| {
            calls += 1;
            Err(io::Error::from_raw_os_error(libc::ENOSYS))
        });
        assert_eq!(result.unwrap_err().raw_os_error(), Some(libc::ENOSYS));
        assert_eq!(calls, 1);
        assert!(fill(&mut bytes, |_| Ok(0)).is_err());
    }

    #[test]
    fn short_and_interrupted_reads_are_retried() {
        let mut bytes = [0u8; 8];
        let mut calls = 0;
        fill(&mut bytes, |rest| {
            calls += 1;
            if calls == 1 {
                return Err(io::ErrorKind::Interrupted.into());
            }
            rest[0] = 7;
            Ok(1)
        })
        .unwrap();
        assert_eq!(bytes, [7; 8]);
        assert_eq!(calls, 9);
    }

    #[test]
    fn handles_are_long_and_from_the_alphabet() {
        let handle = new_handle().unwrap();
        assert_eq!(handle.len(), HANDLE_LENGTH);
        assert!(handle.bytes().all(|b| ALPHABET.contains(&b)));
    }
}
