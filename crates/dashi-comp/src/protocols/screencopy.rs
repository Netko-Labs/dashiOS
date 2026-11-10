//! wlr-screencopy (screen sharing through xdg-desktop-portal-wlr, screenshot
//! tools): a screen or a part of it, copied into the client's shm buffer.
//! Only the shell and the executables it grants (`screencopy-clients {paths}`)
//! may see the global. While copies keep coming the shell hears
//! `screen-capture {active: true}` (so it can show it), and `false` once they
//! stop.
//!
//! `copy_with_damage` is what recorders and screen sharing loop on: those
//! copies are paced to the screen's refresh (at most `MAX_FPS`), so a
//! recorder gets a steady stream instead of copies as fast as the GPU
//! renders them; each reports the whole frame as damaged.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicI32},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use smithay::{
    output::Output,
    reexports::{
        calloop::timer::{TimeoutAction, Timer},
        wayland_protocols_wlr::screencopy::v1::server::{
            zwlr_screencopy_frame_v1::{self as frame_v1, ZwlrScreencopyFrameV1},
            zwlr_screencopy_manager_v1::{self as manager_v1, ZwlrScreencopyManagerV1},
        },
        wayland_server::{
            Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
            protocol::{wl_buffer::WlBuffer, wl_shm},
        },
    },
    utils::{Logical, Rectangle},
};

use crate::{backend, render::View, session::trust, state::Dashi};

mod activity;

pub(crate) use activity::Activity;

/// Who may copy the screen: the shell, and these executables.
#[derive(Clone)]
pub(crate) struct Grants {
    pub shell: Arc<AtomicI32>,
    pub paths: Arc<Mutex<Vec<PathBuf>>>,
}

#[derive(Clone)]
pub(crate) struct FrameData {
    output: Output,
    region: Rectangle<i32, Logical>,
    cursor: bool,
}

pub(crate) fn create_global(dh: &DisplayHandle, grants: Grants) {
    dh.create_global::<Dashi, ZwlrScreencopyManagerV1, Grants>(3, grants);
}

pub(crate) fn may_copy(client: &Client, grants: &Grants) -> bool {
    if trust::is_shell_client(client, &grants.shell) {
        return true;
    }
    let Some(pid) = client
        .get_data::<crate::state::ClientState>()
        .filter(|data| data.sandbox.is_none())
        .and_then(|data| data.pid)
    else {
        return false;
    };
    let Ok(exe) = std::fs::read_link(format!("/proc/{pid}/exe")) else {
        return false;
    };
    grants
        .paths
        .lock()
        .is_ok_and(|paths| paths.iter().any(|allowed| allowed == &exe))
}

impl GlobalDispatch<ZwlrScreencopyManagerV1, Grants> for Dashi {
    fn bind(
        _state: &mut Self,
        _dh: &DisplayHandle,
        _client: &Client,
        resource: New<ZwlrScreencopyManagerV1>,
        _grants: &Grants,
        data_init: &mut DataInit<'_, Self>,
    ) {
        data_init.init(resource, ());
    }

    fn can_view(client: Client, grants: &Grants) -> bool {
        may_copy(&client, grants)
    }
}

impl Dispatch<ZwlrScreencopyManagerV1, ()> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        _manager: &ZwlrScreencopyManagerV1,
        request: manager_v1::Request,
        _data: &(),
        _dh: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        let (frame, cursor, output, region) = match request {
            manager_v1::Request::CaptureOutput {
                frame,
                overlay_cursor,
                output,
            } => (frame, overlay_cursor, output, None),
            manager_v1::Request::CaptureOutputRegion {
                frame,
                overlay_cursor,
                output,
                x,
                y,
                width,
                height,
            } => (
                frame,
                overlay_cursor,
                output,
                Some(Rectangle::new((x, y).into(), (width, height).into())),
            ),
            manager_v1::Request::Destroy => return,
            _ => return,
        };
        let output = Output::from_resource(&output);
        let screen = output.as_ref().and_then(|o| state.space.output_geometry(o));
        let (Some(output), Some(screen)) = (output, screen) else {
            let frame = data_init.init(frame, None);
            frame.failed();
            return;
        };
        // A region is in output-local logical coordinates.
        let area = region
            .map_or(screen, |r| Rectangle::new(r.loc + screen.loc, r.size))
            .intersection(screen);
        let Some(area) = area.filter(|a| a.size.w > 0 && a.size.h > 0) else {
            let frame = data_init.init(frame, None);
            frame.failed();
            return;
        };
        let size = area
            .size
            .to_f64()
            .to_physical(output.current_scale().fractional_scale())
            .to_i32_round::<i32>();
        let frame = data_init.init(
            frame,
            Some(FrameData {
                output,
                region: area,
                cursor: cursor != 0,
            }),
        );
        frame.buffer(
            wl_shm::Format::Xrgb8888,
            size.w as u32,
            size.h as u32,
            size.w as u32 * 4,
        );
        if frame.version() >= 3 {
            frame.buffer_done();
        }
    }
}

impl Dispatch<ZwlrScreencopyFrameV1, Option<FrameData>> for Dashi {
    fn request(
        state: &mut Self,
        _client: &Client,
        frame: &ZwlrScreencopyFrameV1,
        request: frame_v1::Request,
        data: &Option<FrameData>,
        _dh: &DisplayHandle,
        _data_init: &mut DataInit<'_, Self>,
    ) {
        let (buffer, looping) = match request {
            frame_v1::Request::Copy { buffer } => (buffer, false),
            frame_v1::Request::CopyWithDamage { buffer } => (buffer, true),
            _ => return,
        };
        let Some(data) = data else {
            return frame.failed();
        };
        if looping {
            let wait = state.capture_activity.pace(&data.output, Instant::now());
            if !wait.is_zero() {
                let (frame, data) = (frame.clone(), data.clone());
                let _ = state.loop_handle.insert_source(
                    Timer::from_duration(wait),
                    move |_, _, state| {
                        if frame.is_alive() && buffer.is_alive() {
                            serve(state, &frame, &buffer, &data, true);
                        }
                        TimeoutAction::Drop
                    },
                );
                return;
            }
        }
        serve(state, frame, &buffer, data, looping);
    }
}

/// Copy the frame's area into `buffer` and say it is ready.
fn serve(
    state: &mut Dashi,
    frame: &ZwlrScreencopyFrameV1,
    buffer: &WlBuffer,
    data: &FrameData,
    whole_damage: bool,
) {
    let view = View {
        area: data.region,
        scale: data.output.current_scale().fractional_scale().into(),
        output: &data.output,
        cursor: data.cursor,
        only: None,
        decor_scale: None,
    };
    let mut picture = match backend::capture(state, &view) {
        Ok(picture) => picture,
        Err(error) => {
            tracing::debug!(%error, "a screencopy frame");
            return frame.failed();
        }
    };
    // A recorder the shell started for an agent gets the agent's blanks.
    let scale = data.output.current_scale().fractional_scale();
    state.mask_for_client(frame.client(), data.region, scale, &mut picture);
    if !crate::render::capture::copy_to_shm(&picture, buffer) {
        return frame.failed();
    }
    frame.flags(frame_v1::Flags::empty());
    if whole_damage && frame.version() >= 2 {
        frame.damage(
            0,
            0,
            picture.width.max(0) as u32,
            picture.height.max(0) as u32,
        );
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    frame.ready(
        (now.as_secs() >> 32) as u32,
        now.as_secs() as u32,
        now.subsec_nanos(),
    );
    state.note_capture();
}
