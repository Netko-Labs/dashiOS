//! dashi-chrome-v1 (protocols/dashi-chrome-v1.xml): an app asks for the
//! "unified" style, its content running to the top edge with only the traffic
//! lights over it (mirin's Metal host does, for `titleBar: "unified"`).

#![allow(
    non_upper_case_globals,
    non_camel_case_types,
    unused_imports,
    clippy::all
)]

pub(crate) mod generated {
    use wayland_protocols::xdg::shell::server::*;
    use wayland_server;
    use wayland_server::protocol::*;

    pub mod __interfaces {
        use wayland_protocols::xdg::shell::server::__interfaces::*;
        use wayland_server::protocol::__interfaces::*;
        wayland_scanner::generate_interfaces!("protocols/dashi-chrome-v1.xml");
    }
    use self::__interfaces::*;

    wayland_scanner::generate_server_code!("protocols/dashi-chrome-v1.xml");
}

use generated::{dashi_chrome_manager_v1, dashi_chrome_v1};
use smithay::reexports::wayland_server::{
    Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
    protocol::wl_surface::WlSurface,
};

use crate::state::Dashi;

/// A toplevel's chrome object: the surface it is for (none when the toplevel was already gone).
pub(crate) struct ChromeData {
    pub surface: Option<WlSurface>,
}

pub(crate) fn create_global(dh: &DisplayHandle) {
    dh.create_global::<Dashi, dashi_chrome_manager_v1::DashiChromeManagerV1, ()>(1, ());
}

impl GlobalDispatch<dashi_chrome_manager_v1::DashiChromeManagerV1, ()> for Dashi {
    fn bind(
        _state: &mut Self,
        _dh: &DisplayHandle,
        _client: &Client,
        resource: New<dashi_chrome_manager_v1::DashiChromeManagerV1>,
        _global_data: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }
}

impl Dispatch<dashi_chrome_manager_v1::DashiChromeManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        manager: &dashi_chrome_manager_v1::DashiChromeManagerV1,
        request: dashi_chrome_manager_v1::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            dashi_chrome_manager_v1::Request::GetChrome { id, toplevel } => {
                let Some(toplevel) = state.xdg_shell_state.get_toplevel(&toplevel) else {
                    // A toplevel that is already gone: the object does nothing.
                    data_init.init(id, ChromeData { surface: None });
                    return;
                };
                let surface = toplevel.wl_surface().clone();
                if state.chrome_objects.iter().any(|(s, _)| s == &surface) {
                    manager.post_error(
                        dashi_chrome_manager_v1::Error::ChromeExists,
                        "the toplevel already has a dashi_chrome_v1",
                    );
                    return;
                }
                let chrome = data_init.init(
                    id,
                    ChromeData {
                        surface: Some(surface.clone()),
                    },
                );
                state.chrome_objects.push((surface, chrome));
            }
            dashi_chrome_manager_v1::Request::Destroy => {}
        }
    }
}

impl Dispatch<dashi_chrome_v1::DashiChromeV1, ChromeData> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        chrome: &dashi_chrome_v1::DashiChromeV1,
        request: dashi_chrome_v1::Request,
        data: &ChromeData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            dashi_chrome_v1::Request::SetStyle { style } => {
                let unified = match style.into_result() {
                    Ok(dashi_chrome_v1::Style::Unified) => true,
                    Ok(dashi_chrome_v1::Style::Standard) => false,
                    _ => {
                        chrome
                            .post_error(dashi_chrome_v1::Error::InvalidStyle, "not a known style");
                        return;
                    }
                };
                if let Some(surface) = &data.surface {
                    state.set_unified(surface, unified);
                }
            }
            dashi_chrome_v1::Request::Destroy => {
                state.chrome_objects.retain(|(_, object)| object != chrome);
                if let Some(surface) = &data.surface {
                    state.set_unified(surface, false);
                }
            }
        }
    }

    fn destroyed(
        state: &mut Self,
        _client: wayland_backend::server::ClientId,
        chrome: &dashi_chrome_v1::DashiChromeV1,
        _data: &ChromeData,
    ) {
        state.chrome_objects.retain(|(_, object)| object != chrome);
    }
}

/// Tell a unified window where its traffic lights are (an empty rectangle: none).
pub(crate) fn send_controls(
    chrome: &dashi_chrome_v1::DashiChromeV1,
    rect: Option<(i32, i32, i32, i32)>,
) {
    let (x, y, w, h) = rect.unwrap_or((0, 0, 0, 0));
    chrome.controls(x, y, w, h);
}

pub(crate) type ChromeObject = dashi_chrome_v1::DashiChromeV1;
