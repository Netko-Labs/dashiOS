//! Capture sources: a screen or a toplevel (by its foreign-toplevel-list
//! handle), named for a session to capture.

use smithay::{
    output::Output,
    reexports::{
        wayland_protocols::ext::{
            foreign_toplevel_list::v1::server::ext_foreign_toplevel_handle_v1::ExtForeignToplevelHandleV1,
            image_capture_source::v1::server::{
                ext_foreign_toplevel_image_capture_source_manager_v1::{
                    self as toplevel_sources, ExtForeignToplevelImageCaptureSourceManagerV1,
                },
                ext_image_capture_source_v1::{self as source_v1, ExtImageCaptureSourceV1},
                ext_output_image_capture_source_manager_v1::{
                    self as output_sources, ExtOutputImageCaptureSourceManagerV1,
                },
            },
        },
        wayland_server::{Client, DataInit, Dispatch, DisplayHandle},
    },
    wayland::foreign_toplevel_list::ForeignToplevelHandle,
};

use super::Source;
use crate::state::Dashi;

impl Dispatch<ExtOutputImageCaptureSourceManagerV1, ()> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        _manager: &ExtOutputImageCaptureSourceManagerV1,
        request: output_sources::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let output_sources::Request::CreateSource { source, output } = request {
            let source_of = Output::from_resource(&output)
                .map_or(Source::Nothing, |o| Source::Output(o.downgrade()));
            data_init.init(source, source_of);
        }
    }
}

impl Dispatch<ExtForeignToplevelImageCaptureSourceManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        _manager: &ExtForeignToplevelImageCaptureSourceManagerV1,
        request: toplevel_sources::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let toplevel_sources::Request::CreateSource {
            source,
            toplevel_handle,
        } = request
        {
            data_init.init(source, source_for_toplevel(state, &toplevel_handle));
        }
    }
}

fn source_for_toplevel(state: &Dashi, handle: &ExtForeignToplevelHandleV1) -> Source {
    let Some(handle) = ForeignToplevelHandle::from_resource(handle) else {
        return Source::Nothing;
    };
    state
        .toplevel_list
        .as_ref()
        .and_then(|list| list.window_of(&handle))
        .map_or(Source::Nothing, Source::Window)
}

impl Dispatch<ExtImageCaptureSourceV1, Source> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        _source: &ExtImageCaptureSourceV1,
        _request: source_v1::Request,
        _data: &Source,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
    }
}
