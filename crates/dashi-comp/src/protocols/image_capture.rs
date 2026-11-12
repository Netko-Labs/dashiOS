//! ext-image-copy-capture (with ext-image-capture-source): the newer way to
//! copy a screen or a window into a client's buffer, as xdg-desktop-portal's
//! screen and window sharing uses it. shm buffers only (Xrgb8888/Argb8888);
//! a frame is ready at most once per 16 ms. The same clients as screencopy
//! may use it (protocols/screencopy.rs grants); none in greeter mode. Cursor
//! sessions are refused (stopped): ask for `paint_cursors` instead.

use std::{sync::Mutex, time::Duration};

use smithay::{
    output::WeakOutput,
    reexports::{
        calloop::timer::{TimeoutAction, Timer},
        wayland_protocols::ext::{
            image_capture_source::v1::server::{
                ext_foreign_toplevel_image_capture_source_manager_v1::ExtForeignToplevelImageCaptureSourceManagerV1,
                ext_output_image_capture_source_manager_v1::ExtOutputImageCaptureSourceManagerV1,
            },
            image_copy_capture::v1::server::{
                ext_image_copy_capture_cursor_session_v1::{
                    self as cursor_v1, ExtImageCopyCaptureCursorSessionV1,
                },
                ext_image_copy_capture_frame_v1::{self as frame_v1, ExtImageCopyCaptureFrameV1},
                ext_image_copy_capture_manager_v1::{
                    self as manager_v1, ExtImageCopyCaptureManagerV1,
                },
                ext_image_copy_capture_session_v1::{
                    self as session_v1, ExtImageCopyCaptureSessionV1,
                },
            },
        },
        wayland_server::{
            Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
            protocol::wl_buffer::WlBuffer,
        },
    },
};

use crate::{
    protocols::screencopy::{Grants, may_copy},
    state::Dashi,
    wm::WindowId,
};

mod frames;
mod sources;

/// The shortest time between two frames of one session.
const FRAME_EVERY: Duration = Duration::from_millis(16);

/// What a source captures.
#[derive(Clone)]
pub(crate) enum Source {
    Output(WeakOutput),
    Window(WindowId),
    /// A toplevel handle that names no window (any more).
    Nothing,
}

pub(crate) struct SessionData {
    pub(super) source: Source,
    pub(super) cursor: bool,
    /// The buffer size last announced, in pixels.
    pub(super) size: Mutex<(i32, i32)>,
}

#[derive(Default)]
pub(crate) struct FrameState {
    pub(super) buffer: Option<WlBuffer>,
    pub(super) captured: bool,
}

pub(crate) struct FrameData {
    pub(super) session: ExtImageCopyCaptureSessionV1,
    pub(super) state: Mutex<FrameState>,
}

pub(crate) fn create_globals(dh: &DisplayHandle, grants: &Grants) {
    dh.create_global::<Dashi, ExtOutputImageCaptureSourceManagerV1, Grants>(1, grants.clone());
    dh.create_global::<Dashi, ExtForeignToplevelImageCaptureSourceManagerV1, Grants>(
        1,
        grants.clone(),
    );
    dh.create_global::<Dashi, ExtImageCopyCaptureManagerV1, Grants>(1, grants.clone());
}

macro_rules! granted_global {
    ($interface:ty) => {
        impl GlobalDispatch<$interface, Grants> for Dashi {
            fn bind(
                _state: &mut Self,
                _dh: &DisplayHandle,
                _client: &Client,
                resource: New<$interface>,
                _grants: &Grants,
                data_init: &mut DataInit<'_, Self>,
            ) {
                data_init.init(resource, ());
            }

            fn can_view(client: Client, grants: &Grants) -> bool {
                may_copy(&client, grants)
            }
        }
    };
}

granted_global!(ExtOutputImageCaptureSourceManagerV1);
granted_global!(ExtForeignToplevelImageCaptureSourceManagerV1);
granted_global!(ExtImageCopyCaptureManagerV1);

impl Dispatch<ExtImageCopyCaptureManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        _manager: &ExtImageCopyCaptureManagerV1,
        request: manager_v1::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            manager_v1::Request::CreateSession {
                session,
                source,
                options,
            } => {
                let source = source.data::<Source>().cloned().unwrap_or(Source::Nothing);
                let cursor = options
                    .into_result()
                    .is_ok_and(|o| o.contains(manager_v1::Options::PaintCursors));
                let data = SessionData {
                    source,
                    cursor,
                    size: Mutex::new((0, 0)),
                };
                let session = data_init.init(session, data);
                state.announce_constraints(&session);
            }
            manager_v1::Request::CreatePointerCursorSession { session, .. } => {
                data_init.init(session, ());
            }
            _ => {}
        }
    }
}

impl Dispatch<ExtImageCopyCaptureCursorSessionV1, ()> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        _cursor: &ExtImageCopyCaptureCursorSessionV1,
        request: cursor_v1::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        // The cursor is not captured on its own: its session stops at once.
        if let cursor_v1::Request::GetCaptureSession { session } = request {
            let session = data_init.init(
                session,
                SessionData {
                    source: Source::Nothing,
                    cursor: false,
                    size: Mutex::new((0, 0)),
                },
            );
            session.stopped();
        }
    }
}

impl Dispatch<ExtImageCopyCaptureSessionV1, SessionData> for Dashi {
    fn request(
        _state: &mut Self,
        _client: &Client,
        session: &ExtImageCopyCaptureSessionV1,
        request: session_v1::Request,
        _data: &SessionData,
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let session_v1::Request::CreateFrame { frame } = request {
            data_init.init(
                frame,
                FrameData {
                    session: session.clone(),
                    state: Mutex::new(FrameState::default()),
                },
            );
        }
    }
}

impl Dispatch<ExtImageCopyCaptureFrameV1, FrameData> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        frame: &ExtImageCopyCaptureFrameV1,
        request: frame_v1::Request,
        data: &FrameData,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let Ok(mut frame_state) = data.state.lock() else {
            return;
        };
        match request {
            frame_v1::Request::AttachBuffer { buffer } => frame_state.buffer = Some(buffer),
            frame_v1::Request::DamageBuffer { .. } => {}
            frame_v1::Request::Capture => {
                if frame_state.captured {
                    frame.post_error(frame_v1::Error::AlreadyCaptured, "capture was already sent");
                    return;
                }
                let Some(buffer) = frame_state.buffer.clone() else {
                    frame.post_error(frame_v1::Error::NoBuffer, "capture without attach_buffer");
                    return;
                };
                frame_state.captured = true;
                drop(frame_state);
                let frame = frame.clone();
                // Paced: at most one frame per FRAME_EVERY, on the event loop.
                let _ = state.loop_handle.insert_source(
                    Timer::from_duration(FRAME_EVERY),
                    move |_, _, state| {
                        state.capture_frame(&frame, &buffer);
                        TimeoutAction::Drop
                    },
                );
            }
            _ => {}
        }
    }
}
