//! ext-background-effect-v1 (wayland-protocols staging): a client names the
//! region of a surface whose background is blurred. Served to every client;
//! whether it is drawn is the shell's grant (`glass-clients`, render/glass/
//! clients.rs): a client not granted, or any while glass is off, hears
//! `capabilities(0)` and its region is kept but not drawn. The region is
//! double-buffered with the surface (render/glass/surfaces.rs).

use smithay::{
    reexports::{
        wayland_protocols::ext::background_effect::v1::server::{
            ext_background_effect_manager_v1::{self as manager, ExtBackgroundEffectManagerV1},
            ext_background_effect_surface_v1::{self as effect, ExtBackgroundEffectSurfaceV1},
        },
        wayland_server::{
            Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource, Weak,
            protocol::wl_surface::WlSurface,
        },
    },
    wayland::compositor::get_region_attributes,
};

use crate::{render::glass::surfaces, state::Dashi};

/// The surface an effect object is for (weak: the object goes inert with it).
pub(crate) struct EffectData {
    surface: Weak<WlSurface>,
}

pub(crate) fn create_global(dh: &DisplayHandle) {
    dh.create_global::<Dashi, ExtBackgroundEffectManagerV1, ()>(1, ());
}

impl GlobalDispatch<ExtBackgroundEffectManagerV1, ()> for Dashi {
    fn bind(
        state: &mut Self,
        dh: &DisplayHandle,
        client: &Client,
        resource: New<ExtBackgroundEffectManagerV1>,
        _global_data: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        let manager = data_init.init(resource, ());
        state.glass.clients.learn(dh, client, &state.shell_pid);
        let drawn = state.glass_drawn(client);
        manager.capabilities(capabilities(drawn));
        state.glass.said.insert(manager.id(), drawn);
        state.glass.managers.push(manager.downgrade());
    }
}

/// The capabilities a client hears: blur when its glass is drawn.
pub(crate) fn capabilities(drawn: bool) -> manager::Capability {
    if drawn {
        manager::Capability::Blur
    } else {
        manager::Capability::empty()
    }
}

impl Dispatch<ExtBackgroundEffectManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        manager: &ExtBackgroundEffectManagerV1,
        request: manager::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            manager::Request::GetBackgroundEffect { id, surface } => {
                if state.glass.effects.iter().any(|known| known == &surface) {
                    manager.post_error(
                        manager::Error::BackgroundEffectExists,
                        "the surface already has a background effect object",
                    );
                    return;
                }
                state.glass.effects.push(surface.clone());
                data_init.init(
                    id,
                    EffectData {
                        surface: surface.downgrade(),
                    },
                );
            }
            manager::Request::Destroy => {}
            _ => {}
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: smithay::reexports::wayland_server::backend::ClientId,
        manager: &ExtBackgroundEffectManagerV1,
        _data: &(),
    ) {
        state
            .glass
            .managers
            .retain(|known| known.upgrade().is_ok_and(|known| &known != manager));
    }
}

impl Dispatch<ExtBackgroundEffectSurfaceV1, EffectData> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        object: &ExtBackgroundEffectSurfaceV1,
        request: effect::Request,
        data: &EffectData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let Ok(surface) = data.surface.upgrade() else {
            if matches!(request, effect::Request::SetBlurRegion { .. }) {
                object.post_error(
                    effect::Error::SurfaceDestroyed,
                    "the surface has been destroyed",
                );
            }
            return;
        };
        match request {
            effect::Request::SetBlurRegion { region } => {
                let rects = region.map(|region| get_region_attributes(&region));
                let rects = surfaces::region_rects(rects.as_ref());
                surfaces::pending(&surface, |glass| glass.region = Some(rects));
            }
            // "The effect regions will be removed on the next commit."
            effect::Request::Destroy => {
                surfaces::pending(&surface, |glass| glass.region = Some(Vec::new()));
            }
            _ => {}
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: smithay::reexports::wayland_server::backend::ClientId,
        _object: &ExtBackgroundEffectSurfaceV1,
        data: &EffectData,
    ) {
        state
            .glass
            .effects
            .retain(|known| known.is_alive() && known.downgrade() != data.surface);
    }
}
