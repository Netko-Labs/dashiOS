//! Video wallpapers, played by the compositor itself with GStreamer: decoded
//! (in hardware when VA-API is there, through `decodebin`), converted to RGBA
//! no wider than 1920 pixels, looped, and silent. Frames come to the event loop
//! through a channel that holds one: a frame the compositor has not drawn yet
//! is replaced, never queued behind.

use std::{path::Path, thread};

use gstreamer::{self as gst, prelude::*};
use gstreamer_app::{AppSink, AppSinkCallbacks};
use gstreamer_video::{VideoFrameExt, VideoFrameRef, VideoInfo};
use smithay::reexports::calloop::channel::{Sender, SyncSender};

/// A decoded frame: straight RGBA, tightly packed rows.
pub(crate) struct Frame {
    pub width: i32,
    pub height: i32,
    pub rgba: Vec<u8>,
}

/// What the player tells the compositor besides frames.
pub(crate) enum Status {
    Playing,
    Failed(String),
}

pub(crate) struct Player {
    pipeline: gst::Element,
}

impl Player {
    pub(crate) fn start(
        path: &Path,
        frames: SyncSender<Frame>,
        status: Sender<Status>,
    ) -> Result<Self, String> {
        gst::init().map_err(|error| format!("GStreamer: {error}"))?;
        let uri = gst::glib::filename_to_uri(path, None).map_err(|error| error.to_string())?;

        let sink = AppSink::builder()
            .caps(
                &gst::Caps::builder("video/x-raw")
                    .field("format", "RGBA")
                    .field("width", gst::IntRange::new(1, 1920))
                    .field("pixel-aspect-ratio", gst::Fraction::new(1, 1))
                    .build(),
            )
            .max_buffers(1)
            .drop(true)
            .build();
        let first = status.clone();
        let mut announced = false;
        sink.set_callbacks(
            AppSinkCallbacks::builder()
                .new_sample(move |sink| {
                    let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    let frame = sample
                        .caps()
                        .and_then(|caps| VideoInfo::from_caps(caps).ok())
                        .and_then(|info| {
                            let buffer = sample.buffer()?;
                            let frame =
                                VideoFrameRef::from_buffer_ref_readable(buffer, &info).ok()?;
                            Some(pack(&frame, info.width() as usize, info.height() as usize))
                        });
                    if let Some(frame) = frame {
                        if !announced {
                            announced = true;
                            let _ = first.send(Status::Playing);
                        }
                        // Full: the loop has a frame it has not drawn; this one is dropped.
                        let _ = frames.try_send(frame);
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );

        let convert = gst::parse::bin_from_description("videoconvert ! videoscale", true)
            .map_err(|error| error.to_string())?;
        let video_sink = gst::Bin::new();
        video_sink
            .add_many([convert.upcast_ref::<gst::Element>(), sink.upcast_ref()])
            .map_err(|error| error.to_string())?;
        convert.link(&sink).map_err(|error| error.to_string())?;
        let pad = convert.static_pad("sink").ok_or("no sink pad")?;
        video_sink
            .add_pad(&gst::GhostPad::with_target(&pad).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;

        let pipeline = gst::ElementFactory::make("playbin")
            .property("uri", uri.as_str())
            .property("video-sink", &video_sink)
            .property(
                "audio-sink",
                gst::ElementFactory::make("fakesink")
                    .build()
                    .map_err(|error| error.to_string())?,
            )
            .property("mute", true)
            .build()
            .map_err(|error| format!("GStreamer's playbin is missing: {error}"))?;

        let bus = pipeline.bus().ok_or("no bus")?;
        let looping = pipeline.downgrade();
        thread::Builder::new()
            .name("wallpaper-video".into())
            .spawn(move || {
                for message in bus.iter_timed(gst::ClockTime::NONE) {
                    match message.view() {
                        gst::MessageView::Eos(_) => {
                            let Some(pipeline) = looping.upgrade() else {
                                break;
                            };
                            let _ = pipeline.seek_simple(
                                gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT,
                                gst::ClockTime::ZERO,
                            );
                        }
                        gst::MessageView::Error(error) => {
                            let _ = status.send(Status::Failed(error.error().to_string()));
                            break;
                        }
                        _ => {}
                    }
                    if looping.upgrade().is_none() {
                        break;
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "the video does not play".to_string())?;
        Ok(Self { pipeline })
    }

    pub(crate) fn set_paused(&self, paused: bool) {
        let state = if paused {
            gst::State::Paused
        } else {
            gst::State::Playing
        };
        let _ = self.pipeline.set_state(state);
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// A frame's rows without the stride's padding.
fn pack(frame: &VideoFrameRef<&gst::BufferRef>, width: usize, height: usize) -> Frame {
    let stride = frame.plane_stride()[0] as usize;
    let data = frame.plane_data(0).unwrap_or_default();
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        let start = row * stride;
        rgba.extend_from_slice(data.get(start..start + width * 4).unwrap_or(&[]));
    }
    Frame {
        width: width as i32,
        height: height as i32,
        rgba,
    }
}
