//! A session's frames: what its source shows now, the buffer it needs, and
//! a frame copied into the client's buffer.

use std::time::{SystemTime, UNIX_EPOCH};

use smithay::{
    output::Output,
    reexports::{
        wayland_protocols::ext::image_copy_capture::v1::server::{
            ext_image_copy_capture_frame_v1::{self as frame_v1, ExtImageCopyCaptureFrameV1},
            ext_image_copy_capture_session_v1::ExtImageCopyCaptureSessionV1,
        },
        wayland_server::{
            Resource,
            protocol::{wl_buffer::WlBuffer, wl_output, wl_shm},
        },
    },
    utils::{Logical, Rectangle},
};

use super::{FrameData, SessionData, Source};
use crate::{
    backend,
    render::{View, capture::window_area},
    state::Dashi,
};

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
    pub(super) fn announce_constraints(&self, session: &ExtImageCopyCaptureSessionV1) {
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

    pub(super) fn capture_frame(&mut self, frame: &ExtImageCopyCaptureFrameV1, buffer: &WlBuffer) {
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
            decor_scale: None,
        };
        let mut picture = match backend::capture(self, &view) {
            Ok(picture) => picture,
            Err(error) => {
                tracing::debug!(%error, "an image-copy-capture frame");
                frame.failed(frame_v1::FailureReason::Unknown);
                return;
            }
        };
        // A client the shell masked (a recorder for an agent) gets its blanks.
        let scale = output.current_scale().fractional_scale();
        self.mask_for_client(frame.client(), area, scale, &mut picture);
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
