//! One live video source, played with GStreamer: a PipeWire stream (what
//! dashi-camera publishes as its preview) taken as RGBA. Frames come to the
//! event loop through a channel that holds one, as the wallpaper's do
//! (wallpaper/video.rs): a frame not drawn yet is replaced, never queued.
//!
//! The stream is asked for by name and never falls back to another node
//! (`node.dont-fallback`): if the preview is gone, nothing plays, and the
//! compositor never ends up reading a camera itself.

use std::thread;

use gstreamer::{self as gst, prelude::*};
use gstreamer_app::{AppSink, AppSinkCallbacks};
use gstreamer_video::{VideoFrameExt, VideoFrameRef, VideoInfo};
use smithay::reexports::calloop::channel::{Sender, SyncSender};

use crate::wallpaper::VideoFrame as Frame;

/// What the player says besides frames.
pub(crate) enum Status {
    Playing,
    Failed(String),
}

pub(crate) struct Player {
    pipeline: gst::Pipeline,
}

fn set(element: &gst::Element, name: &str, value: &str) {
    if element.has_property(name) {
        element.set_property_from_str(name, value);
    }
}

impl Player {
    pub(crate) fn start(
        source: &str,
        frames: SyncSender<Frame>,
        status: Sender<Status>,
    ) -> Result<Self, String> {
        gst::init().map_err(|error| format!("GStreamer: {error}"))?;
        let pipeline = gst::parse::launch(
            "pipewiresrc name=src ! videoconvert ! video/x-raw,format=RGBA,pixel-aspect-ratio=1/1 \
             ! appsink name=sink max-buffers=1 drop=true sync=false",
        )
        .map_err(|error| format!("GStreamer: {error} (is pipewire-gstreamer installed?)"))?
        .downcast::<gst::Pipeline>()
        .map_err(|_| "not a pipeline".to_string())?;
        let src = pipeline.by_name("src").ok_or("no source")?;
        set(&src, "target-object", source);
        set(&src, "client-name", "dashi-comp");
        if src.has_property("stream-properties") {
            let props = gst::Structure::builder("props")
                .field("node.dont-fallback", true)
                .field("node.dont-reconnect", true)
                .field("media.role", "Production")
                .build();
            src.set_property("stream-properties", props);
        }
        let sink = pipeline
            .by_name("sink")
            .and_then(|sink| sink.downcast::<AppSink>().ok())
            .ok_or("no sink")?;
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
                            let frame =
                                VideoFrameRef::from_buffer_ref_readable(sample.buffer()?, &info)
                                    .ok()?;
                            pack(&frame, info.width() as usize, info.height() as usize)
                        });
                    if let Some(frame) = frame {
                        if !announced {
                            announced = true;
                            let _ = first.send(Status::Playing);
                        }
                        let _ = frames.try_send(frame);
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );
        let bus = pipeline.bus().ok_or("no bus")?;
        let weak = pipeline.downgrade();
        thread::Builder::new()
            .name("video-view".into())
            .spawn(move || {
                while weak.upgrade().is_some() {
                    let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(250)) else {
                        continue;
                    };
                    match message.view() {
                        gst::MessageView::Error(error) => {
                            let _ = status.send(Status::Failed(error.error().to_string()));
                            break;
                        }
                        gst::MessageView::Eos(_) => {
                            let _ = status.send(Status::Failed("the stream ended".into()));
                            break;
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "the stream does not play".to_string())?;
        Ok(Self { pipeline })
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// A frame's rows without the stride's padding.
fn pack(frame: &VideoFrameRef<&gst::BufferRef>, width: usize, height: usize) -> Option<Frame> {
    let stride = usize::try_from(frame.plane_stride()[0]).ok()?;
    let data = frame.plane_data(0).ok()?;
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        rgba.extend_from_slice(data.get(row * stride..row * stride + width * 4)?);
    }
    Some(Frame {
        width: width as i32,
        height: height as i32,
        rgba,
    })
}
