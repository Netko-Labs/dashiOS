//! dashi_glass_v1 (dashi-chrome-v1 version 2, protocols/PROTOCOL.md): a
//! surface's panes of glass, each a rounded rectangle and a material level,
//! double-buffered with the surface (render/glass/surfaces.rs). It hears
//! whether the compositor draws them (`drawing`) and the backdrop's tone.

use smithay::{
    reexports::wayland_server::{
        Client, DataInit, Dispatch, DisplayHandle, Resource, Weak, protocol::wl_surface::WlSurface,
    },
    utils::Rectangle,
};

use super::dashi_chrome::generated::dashi_glass_v1::{self, DashiGlassV1};
use crate::{
    render::glass::{
        Level,
        surfaces::{self, ClientPane, MOST_PANES, MOST_RADIUS},
    },
    state::Dashi,
};

/// The surface a glass object is for (weak: the object goes inert with it).
pub(crate) struct GlassData {
    surface: Weak<WlSurface>,
}

/// Make the glass object `id` of `surface` (the manager checked there is none yet).
pub(crate) fn make(
    state: &mut Dashi,
    dh: &DisplayHandle,
    client: &Client,
    id: smithay::reexports::wayland_server::New<DashiGlassV1>,
    surface: &WlSurface,
    data_init: &mut DataInit<'_, Dashi>,
) {
    let object = data_init.init(
        id,
        GlassData {
            surface: surface.downgrade(),
        },
    );
    state.glass.clients.learn(dh, client, &state.shell_pid);
    let drawn = state.glass_material(client);
    object.drawing(drawing(drawn));
    state.glass.said.insert(object.id(), drawn);
    state.glass.objects.push((surface.downgrade(), object));
}

/// The drawing a client hears.
pub(crate) fn drawing(material: bool) -> dashi_glass_v1::Drawing {
    if material {
        dashi_glass_v1::Drawing::Material
    } else {
        dashi_glass_v1::Drawing::None
    }
}

impl Dispatch<DashiGlassV1, GlassData> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        object: &DashiGlassV1,
        request: dashi_glass_v1::Request,
        data: &GlassData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let Ok(surface) = data.surface.upgrade() else {
            return;
        };
        match request {
            dashi_glass_v1::Request::AddPane {
                x,
                y,
                width,
                height,
                radius,
                level,
            } => {
                let Some(level) = level
                    .into_result()
                    .ok()
                    .and_then(|l| Level::from_wire(l.into()))
                else {
                    object.post_error(dashi_glass_v1::Error::InvalidLevel, "not a known level");
                    return;
                };
                if width < 0 || height < 0 || radius > MOST_RADIUS {
                    object.post_error(
                        dashi_glass_v1::Error::InvalidPane,
                        "a negative size, or a radius over 512",
                    );
                    return;
                }
                let pane = ClientPane {
                    rect: Rectangle::new((x, y).into(), (width, height).into()),
                    radius,
                    level,
                };
                let mut many = false;
                surfaces::pending(&surface, |glass| {
                    let panes = glass.panes.get_or_insert_with(Vec::new);
                    many = panes.len() >= MOST_PANES;
                    if !many {
                        panes.push(pane);
                    }
                });
                if many {
                    object.post_error(
                        dashi_glass_v1::Error::TooManyPanes,
                        "more than 16 panes in one commit",
                    );
                }
            }
            dashi_glass_v1::Request::Clear => {
                surfaces::pending(&surface, |glass| glass.panes = Some(Vec::new()));
            }
            dashi_glass_v1::Request::Destroy => {
                surfaces::pending(&surface, |glass| glass.panes = Some(Vec::new()));
            }
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: smithay::reexports::wayland_server::backend::ClientId,
        object: &DashiGlassV1,
        _data: &GlassData,
    ) {
        state.glass.objects.retain(|(_, known)| known != object);
    }
}
