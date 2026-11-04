//! Buffers are used only once the GPU is done with them: a commit waits for
//! its linux-drm-syncobj acquire point (explicit sync, as NVIDIA and Vulkan
//! clients use it), or else for its dmabuf to be readable (implicit sync), so
//! a frame never shows a half-drawn buffer nor stalls the compositor's GPU.

use smithay::{
    backend::{allocator::dmabuf::Dmabuf, drm::DrmDeviceFd},
    delegate_drm_syncobj,
    reexports::{
        calloop::Interest,
        wayland_server::{DisplayHandle, Resource, protocol::wl_surface::WlSurface},
    },
    wayland::{
        compositor::{
            BufferAssignment, CompositorHandler, SurfaceAttributes, add_blocker,
            add_pre_commit_hook, with_states,
        },
        dmabuf::get_dmabuf,
        drm_syncobj::{
            DrmSyncobjCachedState, DrmSyncobjHandler, DrmSyncobjState, supports_syncobj_eventfd,
        },
    },
};

use crate::state::Dashi;

/// Offer explicit sync when the drawing GPU can wait on syncobjs (udev only).
pub(crate) fn offer_explicit_sync(state: &mut Dashi, dh: &DisplayHandle, device: DrmDeviceFd) {
    if state.syncobj_state.is_some() {
        return;
    }
    if supports_syncobj_eventfd(&device) {
        state.syncobj_state = Some(DrmSyncobjState::new::<Dashi>(dh, device));
        tracing::info!("explicit sync (linux-drm-syncobj) is offered");
    } else {
        tracing::info!("the GPU cannot wait on syncobjs; no explicit sync");
    }
}

/// Every new surface's commits wait for their buffer (see the module doc).
pub(crate) fn watch_surface(surface: &WlSurface) {
    add_pre_commit_hook::<Dashi, _>(surface, |state, _dh, surface| {
        let (acquire, dmabuf) = with_states(surface, |data| {
            let acquire = data
                .cached_state
                .get::<DrmSyncobjCachedState>()
                .pending()
                .acquire_point
                .clone();
            let dmabuf = data
                .cached_state
                .get::<SurfaceAttributes>()
                .pending()
                .buffer
                .as_ref()
                .and_then(|assignment| match assignment {
                    BufferAssignment::NewBuffer(buffer) => get_dmabuf(buffer).cloned().ok(),
                    _ => None,
                });
            (acquire, dmabuf)
        });
        let Some(dmabuf) = dmabuf else { return };
        if let Some(acquire) = acquire
            && let Ok((blocker, source)) = acquire.generate_blocker()
            && wait_for(state, surface, source)
        {
            add_blocker(surface, blocker);
            return;
        }
        wait_for_dmabuf(state, surface, &dmabuf);
    });
}

fn wait_for_dmabuf(state: &mut Dashi, surface: &WlSurface, dmabuf: &Dmabuf) {
    if let Ok((blocker, source)) = dmabuf.generate_blocker(Interest::READ)
        && wait_for(state, surface, source)
    {
        add_blocker(surface, blocker);
    }
}

/// When `source` fires, the client's blocked commit goes through.
fn wait_for<S>(state: &mut Dashi, surface: &WlSurface, source: S) -> bool
where
    S: smithay::reexports::calloop::EventSource<Event = (), Ret = Result<(), std::io::Error>>
        + 'static,
{
    let Some(client) = surface.client() else {
        return false;
    };
    state
        .loop_handle
        .insert_source(source, move |_, _, state| {
            let dh = state.display_handle.clone();
            state
                .client_compositor_state(&client)
                .blocker_cleared(state, &dh);
            Ok(())
        })
        .is_ok()
}

impl DrmSyncobjHandler for Dashi {
    fn drm_syncobj_state(&mut self) -> Option<&mut DrmSyncobjState> {
        self.syncobj_state.as_mut()
    }
}

delegate_drm_syncobj!(Dashi);
