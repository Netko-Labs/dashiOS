//! ext-image-copy-capture (with ext-image-capture-source): the newer way to
//! copy a screen or a window into a client's buffer, as xdg-desktop-portal's
//! screen and window sharing uses it. shm buffers only (Xrgb8888/Argb8888);
//! a frame is ready at most once per 16 ms. The same clients as screencopy
//! may use it (protocols/screencopy.rs grants); none in greeter mode. Cursor
//! sessions are refused (stopped): ask for `paint_cursors` instead.

use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use smithay::{
    output::{Output, WeakOutput},
    reexports::{
        calloop::timer::{TimeoutAction, Timer},
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
            protocol::{wl_buffer::WlBuffer, wl_output, wl_shm},
        },
    },
    utils::{Logical, Rectangle},
    wayland::foreign_toplevel_list::ForeignToplevelHandle,
};

use crate::{
    backend,
    protocols::screencopy::{Grants, may_copy},
    render::{View, capture::window_area},
    state::Dashi,
    wm::WindowId,
};

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
    source: Source,
    cursor: bool,
    /// The buffer size last announced, in pixels.
    size: Mutex<(i32, i32)>,
}

#[derive(Default)]
pub(crate) struct FrameState {
    buffer: Option<WlBuffer>,
    captured: bool,
}

pub(crate) struct FrameData {
    session: ExtImageCopyCaptureSessionV1,
    state: Mutex<FrameState>,
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

impl Dashi {
    /// What a session's source shows now: the area, the screen, and the window alone if any.
    fn source_view(
        &self,
        source: &Source,
    ) -> Option<(
        Rectangle<i32, Logical>,
        Output,
        Option<smithay::desktop::Window>,
    )> {
        match source {
            Source::Output(weak) => {
                let output = weak.upgrade()?;
                let area = self.space.output_geometry(&output)?;
                Some((area, output, None))
            }
            Source::Window(id) => {
                let window = self
                    .windows
                    .get(*id)
                    .filter(|e| e.announced)?
                    .window
                    .clone();
                let (area, output) = window_area(self, &window).ok()?;
                Some((area, output, Some(window)))
            }
            Source::Nothing => None,
        }
    }

    /// Tell a session the buffer it needs, or that it has nothing to capture.
    fn announce_constraints(&self, session: &ExtImageCopyCaptureSessionV1) {
        let Some(data) = session.data::<SessionData>() else {
            return;
        };
        let Some((area, output, _)) = self.source_view(&data.source) else {
            session.stopped();
            return;
        };
        let size = pixel_size(area, &output);
        if let Ok(mut last) = data.size.lock() {
            *last = size;
        }
        session.buffer_size(size.0 as u32, size.1 as u32);
        session.shm_format(wl_shm::Format::Xrgb8888);
        session.shm_format(wl_shm::Format::Argb8888);
        session.done();
    }

    fn capture_frame(&mut self, frame: &ExtImageCopyCaptureFrameV1, buffer: &WlBuffer) {
        if !frame.is_alive() {
            return;
        }
        let Some(data) = frame.data::<FrameData>() else {
            return;
        };
        let session = data.session.clone();
        let Some(session_data) = session.data::<SessionData>() else {
            return;
        };
        let Some((area, output, only)) = self.source_view(&session_data.source) else {
            frame.failed(frame_v1::FailureReason::Stopped);
            session.stopped();
            return;
        };
        let size = pixel_size(area, &output);
        let announced = session_data.size.lock().map(|s| *s).unwrap_or_default();
        if size != announced {
            // The source changed size: the client hears the new constraints.
            frame.failed(frame_v1::FailureReason::BufferConstraints);
            self.announce_constraints(&session);
            return;
        }
        let view = View {
            area,
            scale: output.current_scale().fractional_scale().into(),
            output: &output,
            cursor: session_data.cursor,
            only,
        };
        let picture = match backend::capture(self, &view) {
            Ok(picture) => picture,
            Err(error) => {
                tracing::debug!(%error, "an image-copy-capture frame");
                frame.failed(frame_v1::FailureReason::Unknown);
                return;
            }
        };
        if !crate::render::capture::copy_to_shm(&picture, buffer) {
            frame.failed(frame_v1::FailureReason::BufferConstraints);
            return;
        }
        frame.transform(wl_output::Transform::Normal);
        frame.damage(0, 0, size.0, size.1);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        frame.presentation_time(
            (now.as_secs() >> 32) as u32,
            now.as_secs() as u32,
            now.subsec_nanos(),
        );
        frame.ready();
        self.note_capture();
    }
}

/// An area's size in pixels at its screen's scale.
fn pixel_size(area: Rectangle<i32, Logical>, output: &Output) -> (i32, i32) {
    let size = area
        .size
        .to_f64()
        .to_physical(output.current_scale().fractional_scale())
        .to_i32_round::<i32>();
    (size.w.max(1), size.h.max(1))
}
