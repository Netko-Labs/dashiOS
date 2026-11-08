//! The live pipeline: the webcam through PipeWire, decoded, through the
//! effects slot, then split three ways (docs/camera.md, "The frame path"):
//!
//! ```txt
//! pipewiresrc (the camera) → decodebin → scale ≤1080p → [effects] → tee
//!   ├ queue (leaky) → RGBA ≤720p → pipewiresink "dashi-camera-preview"  (the compositor shows it)
//!   ├ queue (leaky) → RGB → appsink "stills"                            (photos, posters)
//!   └ queue (leaky) → I420 → appsink "tap"                              (a recording's appsrc)
//! ```
//!
//! `effects` is an `identity` today: the ONNX and Vulkan stages replace it
//! later, so the preview, photos, recordings and the "Dashi Camera" source
//! all see the same frames. Every branch has a leaky queue, so a slow one
//! (nobody watching the preview, an encoder falling behind) drops its own
//! frames and never holds up the camera.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use gstreamer::{self as gst, prelude::*};
use gstreamer_app::{AppSink, AppSinkCallbacks, AppSrc};
use gstreamer_video::{VideoFrameExt, VideoFrameRef, VideoInfo};

use crate::{out::Out, still::Frame};

const PIPELINE: &str = "pipewiresrc name=camera do-timestamp=true \
    ! capsfilter name=wanted ! decodebin ! videoconvert ! videoscale ! capsfilter name=size \
    ! identity name=effects ! tee name=frames \
    frames. ! queue leaky=downstream max-size-buffers=2 max-size-bytes=0 max-size-time=0 \
      ! videoconvert ! videoscale ! capsfilter name=preview-caps ! pipewiresink name=preview sync=false \
    frames. ! queue leaky=downstream max-size-buffers=1 max-size-bytes=0 max-size-time=0 \
      ! videoconvert ! video/x-raw,format=RGB ! appsink name=stills max-buffers=1 drop=true sync=false \
    frames. ! queue leaky=downstream max-size-buffers=8 max-size-bytes=0 max-size-time=0 \
      ! videoconvert ! video/x-raw,format=I420 ! appsink name=tap max-buffers=8 drop=true sync=false";

/// What the camera is asked for, best first: MJPEG (a UVC webcam's fast mode) at a
/// usable size and rate, raw the same, then anything it has.
const WANTED: &str = "image/jpeg,width=[320,1920],height=[240,1080],framerate=[15/1,60/1]; \
    video/x-raw,width=[320,1920],height=[240,1080],framerate=[15/1,60/1]; image/jpeg; video/x-raw";
/// Photos and recordings: at most 1080p, square pixels (sizes even for 4:2:0).
const SIZE: &str = "video/x-raw,width=[2,1920,2],height=[2,1080,2],pixel-aspect-ratio=1/1";
/// The preview the compositor draws: RGBA, at most 720p.
const PREVIEW: &str =
    "video/x-raw,format=RGBA,width=[1,1280],height=[1,720],pixel-aspect-ratio=1/1";

/// Where the tap's frames go while a recording runs.
type Tap = Arc<Mutex<Option<AppSrc>>>;

pub struct Camera {
    pipeline: gst::Pipeline,
    stills: AppSink,
    tap: Tap,
    tap_caps: Arc<Mutex<Option<gst::Caps>>>,
    failed: Arc<Mutex<Option<String>>>,
    done: Arc<AtomicBool>,
}

/// Sets `name` on `element` from text when it has such a property (gstreamer-rs panics on one it lacks).
pub fn set(element: &gst::Element, name: &str, value: &str) {
    if element.has_property(name) {
        element.set_property_from_str(name, value);
    }
}

fn caps(text: &str) -> Result<gst::Caps, String> {
    text.parse::<gst::Caps>()
        .map_err(|_| format!("bad caps {text:?}"))
}

fn named(bin: &gst::Pipeline, name: &str) -> Result<gst::Element, String> {
    bin.by_name(name)
        .ok_or_else(|| format!("no {name} in the pipeline"))
}

impl Camera {
    /// Starts `camera` (a PipeWire target) and publishes the preview as `preview`.
    pub fn open(camera: &str, preview: &str, out: Out) -> Result<Self, String> {
        let pipeline = gst::parse::launch(PIPELINE)
            .map_err(|error| format!("GStreamer: {error} (is pipewire-gstreamer installed?)"))?
            .downcast::<gst::Pipeline>()
            .map_err(|_| "not a pipeline".to_string())?;
        let source = named(&pipeline, "camera")?;
        set(&source, "target-object", camera);
        set(&source, "client-name", "dashi-camera");
        named(&pipeline, "wanted")?.set_property("caps", caps(WANTED)?);
        named(&pipeline, "size")?.set_property("caps", caps(SIZE)?);
        named(&pipeline, "preview-caps")?.set_property("caps", caps(PREVIEW)?);
        let sink = named(&pipeline, "preview")?;
        set(&sink, "mode", "provide");
        set(&sink, "client-name", "dashi-camera");
        if sink.has_property("stream-properties") {
            let props = gst::Structure::builder("props")
                .field("media.class", "Video/Source")
                .field("node.name", preview)
                .field("node.description", "Dashi Camera preview")
                .build();
            sink.set_property("stream-properties", props);
        }
        let stills = named(&pipeline, "stills")?
            .downcast::<AppSink>()
            .map_err(|_| "stills is not an appsink".to_string())?;
        let tap_sink = named(&pipeline, "tap")?
            .downcast::<AppSink>()
            .map_err(|_| "tap is not an appsink".to_string())?;

        let tap: Tap = Arc::default();
        let tap_caps: Arc<Mutex<Option<gst::Caps>>> = Arc::default();
        let (to, seen) = (tap.clone(), tap_caps.clone());
        tap_sink.set_callbacks(
            AppSinkCallbacks::builder()
                .new_sample(move |sink| {
                    let sample = sink.pull_sample().map_err(|_| gst::FlowError::Eos)?;
                    if let (Some(caps), Ok(mut seen)) = (sample.caps(), seen.lock())
                        && seen.as_ref() != Some(&caps.to_owned())
                    {
                        *seen = Some(caps.to_owned());
                    }
                    let target = to.lock().ok().and_then(|target| target.clone());
                    if let (Some(src), Some(buffer)) = (target, sample.buffer()) {
                        // The recording stamps it with its own clock (do-timestamp).
                        let mut copy = buffer.copy();
                        if let Some(copy) = copy.get_mut() {
                            copy.set_pts(gst::ClockTime::NONE);
                            copy.set_dts(gst::ClockTime::NONE);
                            copy.set_duration(gst::ClockTime::NONE);
                        }
                        let _ = src.push_buffer(copy);
                    }
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );

        let failed: Arc<Mutex<Option<String>>> = Arc::default();
        let done = Arc::new(AtomicBool::new(false));
        watch(&pipeline, failed.clone(), done.clone(), out)?;
        pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "the camera did not start".to_string())?;
        Ok(Self {
            pipeline,
            stills,
            tap,
            tap_caps,
            failed,
            done,
        })
    }

    fn failure(&self) -> Option<String> {
        self.failed.lock().ok().and_then(|failed| failed.clone())
    }

    /// The latest frame, waiting up to `wait` for the first; an error if the camera failed.
    pub fn latest(&self, wait: Duration) -> Result<Frame, String> {
        let until = Instant::now() + wait;
        loop {
            if let Some(error) = self.failure() {
                return Err(error);
            }
            if let Some(frame) = self
                .stills
                .property::<Option<gst::Sample>>("last-sample")
                .and_then(|s| rgb(&s))
            {
                return Ok(frame);
            }
            if Instant::now() >= until {
                return Err("the camera sent no picture".into());
            }
            thread::sleep(Duration::from_millis(40));
        }
    }

    /// The tap's caps (what a recording's appsrc takes), waiting up to `wait`.
    pub fn tap_caps(&self, wait: Duration) -> Result<gst::Caps, String> {
        let until = Instant::now() + wait;
        loop {
            if let Some(caps) = self.tap_caps.lock().ok().and_then(|caps| caps.clone()) {
                return Ok(caps);
            }
            if let Some(error) = self.failure() {
                return Err(error);
            }
            if Instant::now() >= until {
                return Err("the camera sent no picture".into());
            }
            thread::sleep(Duration::from_millis(40));
        }
    }

    /// Frames from now on go to `src` (a recording), or nowhere.
    pub fn feed(&self, src: Option<AppSrc>) {
        if let Ok(mut target) = self.tap.lock() {
            *target = src;
        }
    }
}

impl Drop for Camera {
    fn drop(&mut self) {
        self.feed(None);
        self.done.store(true, Ordering::Relaxed);
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// Errors on the pipeline's bus become an `error` event (and fail what waits).
fn watch(
    pipeline: &gst::Pipeline,
    failed: Arc<Mutex<Option<String>>>,
    done: Arc<AtomicBool>,
    out: Out,
) -> Result<(), String> {
    let bus = pipeline.bus().ok_or("no bus")?;
    thread::Builder::new()
        .name("camera-bus".into())
        .spawn(move || {
            while !done.load(Ordering::Relaxed) {
                let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(250)) else {
                    continue;
                };
                if let gst::MessageView::Error(error) = message.view() {
                    let text = error.error().to_string();
                    if let Ok(mut failed) = failed.lock() {
                        failed.get_or_insert_with(|| text.clone());
                    }
                    out.event("error", &text);
                    break;
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// A sample's RGB rows, without the stride's padding.
fn rgb(sample: &gst::Sample) -> Option<Frame> {
    let info = VideoInfo::from_caps(sample.caps()?).ok()?;
    let frame = VideoFrameRef::from_buffer_ref_readable(sample.buffer()?, &info).ok()?;
    let (width, height) = (info.width() as usize, info.height() as usize);
    let stride = usize::try_from(frame.plane_stride()[0]).ok()?;
    let data = frame.plane_data(0).ok()?;
    let mut rgb = Vec::with_capacity(width * height * 3);
    for row in 0..height {
        rgb.extend_from_slice(data.get(row * stride..row * stride + width * 3)?);
    }
    Some(Frame {
        width: info.width(),
        height: info.height(),
        rgb,
    })
}
