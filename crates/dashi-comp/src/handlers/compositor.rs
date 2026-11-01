//! wl_compositor, wl_shm, and buffers: committing surfaces.

use smithay::{
    backend::renderer::utils::on_commit_buffer_handler,
    delegate_compositor, delegate_shm,
    reexports::wayland_server::{
        Client,
        protocol::{wl_buffer, wl_surface::WlSurface},
    },
    wayland::{
        buffer::BufferHandler,
        compositor::{
            CompositorClientState, CompositorHandler, CompositorState, get_parent,
            is_sync_subsurface,
        },
        shm::{ShmHandler, ShmState},
    },
};

use super::{layer_shell, xdg_shell};
use crate::{
    state::{ClientState, Dashi},
    wm::grabs::resize_grab,
};

impl CompositorHandler for Dashi {
    fn compositor_state(&mut self) -> &mut CompositorState {
        &mut self.compositor_state
    }

    fn client_compositor_state<'a>(&self, client: &'a Client) -> &'a CompositorClientState {
        match client.get_data::<ClientState>() {
            Some(data) => &data.compositor_state,
            // Every client is inserted with ClientState (state.rs).
            None => unreachable!("a Wayland client without ClientState"),
        }
    }

    fn commit(&mut self, surface: &WlSurface) {
        on_commit_buffer_handler::<Self>(surface);
        if !is_sync_subsurface(surface) {
            let mut root = surface.clone();
            while let Some(parent) = get_parent(&root) {
                root = parent;
            }
            if let Some(entry) = self.windows.by_surface(&root) {
                entry.window.on_commit();
            }
            self.place_when_drawn(&root);
        }
        xdg_shell::handle_commit(&mut self.popups, &self.space, surface);
        layer_shell::handle_commit(self, surface);
        resize_grab::handle_commit(&mut self.space, surface);
    }
}

impl BufferHandler for Dashi {
    fn buffer_destroyed(&mut self, _buffer: &wl_buffer::WlBuffer) {}
}

impl ShmHandler for Dashi {
    fn shm_state(&self) -> &ShmState {
        &self.shm_state
    }
}

delegate_compositor!(Dashi);
delegate_shm!(Dashi);
