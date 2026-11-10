//! What a window says about itself beyond its title: its icon
//! (xdg-toplevel-icon: a theme name, or pictures saved for the shell under
//! `$XDG_RUNTIME_DIR/dashi-comp-icons/` off the event loop) and the system
//! bell (xdg-system-bell). The shell hears `window-icon` and `bell`; what
//! they look or sound like is its decision.

use crate::ipc::protocol::Event;
use std::{
    hash::{Hash, Hasher},
    path::PathBuf,
};

use smithay::{
    delegate_xdg_system_bell, delegate_xdg_toplevel_icon,
    reexports::{
        wayland_protocols::xdg::shell::server::xdg_toplevel::XdgToplevel,
        wayland_server::{DisplayHandle, Resource, protocol::wl_surface::WlSurface},
    },
    wayland::{
        compositor::with_states,
        shm::with_buffer_contents,
        xdg_system_bell::{XdgSystemBellHandler, XdgSystemBellState},
        xdg_toplevel_icon::{
            ToplevelIconCachedState, XdgToplevelIconHandler, XdgToplevelIconManager,
        },
    },
};

use crate::{state::Dashi, wm::WindowId};

/// The largest icon kept (edge, pixels); bigger pictures are skipped.
const MAX_EDGE: u32 = 1024;

/// Whether xdg-toplevel-icon is offered. Off: smithay 0.7 keeps a destruction
/// hook on an icon's buffer after the client destroyed the icon, so a client
/// that sets an icon, destroys it, then destroys the buffer (legal, and what
/// Chromium does: Helium, the installer's browser) gets a no_buffer protocol
/// error and is disconnected. Windows show their desktop entry's icon until
/// smithay is fixed (or patched here).
const OFFER_TOPLEVEL_ICONS: bool = false;

pub(crate) fn create_globals(dh: &DisplayHandle) {
    if OFFER_TOPLEVEL_ICONS {
        let mut icons = XdgToplevelIconManager::new::<Dashi>(dh);
        for size in [32, 64, 128, 256] {
            icons.add_icon_size(size);
        }
    }
    XdgSystemBellState::new::<Dashi>(dh);
}

/// A window's icon as last told.
#[derive(Default, Clone, PartialEq)]
pub(crate) struct Icon {
    key: u64,
    pub name: Option<String>,
    pub path: Option<PathBuf>,
}

impl XdgToplevelIconHandler for Dashi {
    // The icon applies on the surface's next commit (Dashi::update_icon).
    fn set_icon(&mut self, _toplevel: XdgToplevel, _surface: WlSurface) {}
}

impl XdgSystemBellHandler for Dashi {
    fn ring(&mut self, surface: Option<WlSurface>) {
        let window = surface.and_then(|surface| crate::wm::window_id_for_surface(self, &surface));
        self.ipc.emit(Event::Bell { window });
    }
}

/// An icon picture, copied out of the client's buffer: RGBA rows.
struct Picture {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

impl Dashi {
    /// After a commit: if the window's icon changed, tell the shell.
    pub(crate) fn update_icon(&mut self, surface: &WlSurface) {
        let Some(entry) = self.windows.by_surface(surface) else {
            return;
        };
        let id = entry.id;
        let (name, picture, key) = with_states(surface, |states| {
            let mut cached = states.cached_state.get::<ToplevelIconCachedState>();
            let icon = cached.current();
            let name = icon.icon_name().map(str::to_owned);
            let mut hasher = std::hash::DefaultHasher::new();
            name.hash(&mut hasher);
            for (buffer, scale) in icon.buffers() {
                buffer.id().protocol_id().hash(&mut hasher);
                scale.hash(&mut hasher);
            }
            let largest = icon
                .buffers()
                .iter()
                .filter_map(|(buffer, _)| copy_picture(buffer))
                .max_by_key(|picture| picture.width);
            (name, largest, hasher.finish())
        });
        if entry.icon.key == key {
            return;
        }
        let announced = entry.announced;
        let icon = Icon {
            key,
            name,
            path: None,
        };
        if let Some(entry) = self.windows.get_mut(id) {
            let old = std::mem::replace(&mut entry.icon, icon);
            forget_icon_file(old.path);
        }
        match picture {
            Some(picture) => self.save_icon(id, key, picture),
            None if announced => self.emit_icon(id),
            None => {}
        }
    }

    /// Write the picture on a thread; the shell hears once it is on disk.
    fn save_icon(&mut self, id: WindowId, key: u64, picture: Picture) {
        let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") else {
            return;
        };
        let path = PathBuf::from(runtime)
            .join("dashi-comp-icons")
            .join(format!("{id}-{key:016x}.png"));
        let saved = crate::background::run(
            &self.loop_handle,
            "window-icon",
            move || {
                let saved = write_png(&path, &picture).map(|()| path);
                if let Err(error) = &saved {
                    tracing::debug!(%error, "saving a window's icon");
                }
                saved.ok()
            },
            move |state: &mut Dashi, saved| {
                let current = state.windows.get(id).is_some_and(|e| e.icon.key == key);
                if current {
                    if let Some(entry) = state.windows.get_mut(id) {
                        entry.icon.path = saved;
                    }
                    state.emit_icon(id);
                }
            },
        );
        if let Err(error) = saved {
            tracing::debug!(%error, "no thread to save a window's icon");
        }
    }

    pub(crate) fn emit_icon(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id).filter(|e| e.announced) else {
            return;
        };
        let event = Event::WindowIcon {
            window: id,
            name: entry.icon.name.clone(),
            path: entry
                .icon
                .path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
        };
        self.ipc.emit(event);
    }
}

/// Remove a saved icon nobody shows any more (off the event loop).
pub(crate) fn forget_icon_file(path: Option<PathBuf>) {
    if let Some(path) = path {
        let _ = std::thread::Builder::new()
            .name("window-icon".into())
            .spawn(move || std::fs::remove_file(path));
    }
}

/// A square shm picture (ARGB or XRGB, little-endian) as RGBA.
fn copy_picture(
    buffer: &smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer,
) -> Option<Picture> {
    use smithay::reexports::wayland_server::protocol::wl_shm::Format;
    with_buffer_contents(buffer, |ptr, len, info| {
        let (w, h, stride) = (info.width as u32, info.height as u32, info.stride as u32);
        let opaque = match info.format {
            Format::Argb8888 => false,
            Format::Xrgb8888 => true,
            _ => return None,
        };
        if w == 0 || w != h || w > MAX_EDGE || stride < w * 4 {
            return None;
        }
        let offset = info.offset as usize;
        let needed = offset + (stride * (h - 1) + w * 4) as usize;
        if needed > len {
            return None;
        }
        // SAFETY: the pool is mapped for `len` bytes and only read within `needed`.
        let pool = unsafe { std::slice::from_raw_parts(ptr, len) };
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h as usize {
            let row = offset + y * stride as usize;
            for pixel in pool[row..row + w as usize * 4].as_chunks::<4>().0 {
                let alpha = if opaque { 255 } else { pixel[3] };
                rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], alpha]);
            }
        }
        Some(Picture {
            width: w,
            height: h,
            rgba,
        })
    })
    .ok()
    .flatten()
}

#[expect(
    clippy::disallowed_methods,
    reason = "runs on the window-icon thread (save_icon), off the loop"
)]
fn write_png(path: &std::path::Path, picture: &Picture) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = std::io::BufWriter::new(std::fs::File::create(path)?);
    let mut encoder = png::Encoder::new(file, picture.width, picture.height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(std::io::Error::other)?;
    writer
        .write_image_data(&picture.rgba)
        .map_err(std::io::Error::other)
}

delegate_xdg_toplevel_icon!(Dashi);
delegate_xdg_system_bell!(Dashi);
