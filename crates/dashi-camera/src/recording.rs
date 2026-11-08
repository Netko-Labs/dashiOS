//! A recording: a pipeline of its own, fed the camera's frames through an
//! appsrc (camera.rs's tap), with the microphone, into an MP4:
//!
//! ```txt
//! appsrc (I420) → queue → vapostproc|videoconvert → encoder → parser → queue ┐
//! pulsesrc (the default microphone) → audioconvert → audioresample → opusenc ┼ mp4mux → filesink
//! ```
//!
//! Being its own pipeline, it starts and ends without touching the camera's:
//! the preview never stutters, and stopping sends end-of-stream through it
//! so the MP4 is finished (its index written) before `stop` answers.

use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use gstreamer::{self as gst, prelude::*};
use gstreamer_app::AppSrc;

use crate::{
    camera::set,
    encoders::{self, MUXER, VideoEncoder},
    out::Out,
};

/// How long `stop` waits for the file to be finished.
const FINISH: Duration = Duration::from_secs(10);

pub struct Recording {
    pipeline: gst::Pipeline,
    src: AppSrc,
    path: PathBuf,
    started: Instant,
    finished: mpsc::Receiver<Result<(), String>>,
}

/// What a recording uses, for the shell's reply.
pub struct Chosen {
    pub video: &'static VideoEncoder,
    pub audio: Option<&'static str>,
}

fn has(name: &str) -> bool {
    gst::ElementFactory::find(name).is_some()
}

fn make(name: &str) -> Result<gst::Element, String> {
    gst::ElementFactory::make(name)
        .build()
        .map_err(|_| format!("GStreamer has no {name}"))
}

/// The encoders a recording would use now (`DASHI_CAMERA_ENCODER` forces the video one).
pub fn choose() -> Result<Chosen, String> {
    let force = std::env::var("DASHI_CAMERA_ENCODER").ok();
    if !has(MUXER) {
        return Err(format!("GStreamer has no {MUXER}"));
    }
    let video = encoders::video(&has, force.as_deref()).ok_or(
        "no video encoder: install GStreamer's VA plugin (gstreamer1-plugins-bad-free) or OpenH264 (gstreamer1-plugin-openh264)",
    )?;
    Ok(Chosen {
        video,
        audio: encoders::audio(&has),
    })
}

impl Recording {
    /// Starts recording frames of `caps` to `path` (which must not exist yet).
    pub fn start(
        path: &Path,
        caps: &gst::Caps,
        microphone: bool,
        out: Out,
    ) -> Result<(Self, Chosen), String> {
        if path.exists() {
            return Err(format!("{} is there already", path.display()));
        }
        let chosen = choose()?;
        let pipeline = gst::Pipeline::new();
        let src = gst::ElementFactory::make("appsrc")
            .build()
            .map_err(|_| "GStreamer has no appsrc".to_string())?
            .downcast::<AppSrc>()
            .map_err(|_| "appsrc is not an AppSrc".to_string())?;
        src.set_caps(Some(caps));
        src.set_format(gst::Format::Time);
        src.set_is_live(true);
        src.set_do_timestamp(true);
        let queue = make("queue")?;
        let convert = make(chosen.video.convert)?;
        let encoder = make(chosen.video.element)?;
        for (name, value) in chosen.video.props {
            set(&encoder, name, value);
        }
        let parser = make(chosen.video.parser)?;
        let video_queue = make("queue")?;
        let mux = make(MUXER)?;
        let file = make("filesink")?;
        file.set_property("location", path.to_string_lossy().as_ref());
        pipeline
            .add_many([
                src.upcast_ref(),
                &queue,
                &convert,
                &encoder,
                &parser,
                &video_queue,
                &mux,
                &file,
            ])
            .map_err(|error| error.to_string())?;
        gst::Element::link_many([
            src.upcast_ref(),
            &queue,
            &convert,
            &encoder,
            &parser,
            &video_queue,
            &mux,
            &file,
        ])
        .map_err(|_| {
            format!(
                "{} would not take the camera's frames",
                chosen.video.element
            )
        })?;

        let audio = match chosen.audio.filter(|_| microphone) {
            Some(encoder) => sound(&pipeline, encoder, &mux).ok().map(|()| encoder),
            None => None,
        };

        let (done, finished) = mpsc::channel();
        watch(&pipeline, done, out)?;
        pipeline
            .set_state(gst::State::Playing)
            .map_err(|_| "the recording did not start".to_string())?;
        Ok((
            Self {
                pipeline,
                src,
                path: path.to_path_buf(),
                started: Instant::now(),
                finished,
            },
            Chosen {
                video: chosen.video,
                audio,
            },
        ))
    }

    /// Where the camera's frames go while this runs.
    pub fn src(&self) -> AppSrc {
        self.src.clone()
    }

    /// Ends it and finishes the file; its path and length in seconds.
    pub fn stop(self) -> Result<(PathBuf, f64), String> {
        let seconds = self.started.elapsed().as_secs_f64();
        self.pipeline.send_event(gst::event::Eos::new());
        let outcome = match self.finished.recv_timeout(FINISH) {
            Ok(outcome) => outcome,
            Err(_) => Err("the recording did not finish in time".into()),
        };
        let _ = self.pipeline.set_state(gst::State::Null);
        outcome.map(|()| (self.path.clone(), seconds))
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        let _ = self.pipeline.set_state(gst::State::Null);
    }
}

/// The microphone branch, into `mux`: the default source (PipeWire through its PulseAudio server).
fn sound(pipeline: &gst::Pipeline, encoder: &str, mux: &gst::Element) -> Result<(), String> {
    let source = make("pulsesrc").or_else(|_| make("autoaudiosrc"))?;
    set(&source, "client-name", "dashi-camera");
    let chain = [
        source,
        make("queue")?,
        make("audioconvert")?,
        make("audioresample")?,
        make(encoder)?,
        make("queue")?,
    ];
    pipeline
        .add_many(chain.iter())
        .map_err(|error| error.to_string())?;
    gst::Element::link_many(chain.iter()).map_err(|error| error.to_string())?;
    chain[chain.len() - 1]
        .link(mux)
        .map_err(|_| format!("{MUXER} would not take {encoder}"))
}

/// The end of the stream (the file is finished) or an error, once.
fn watch(
    pipeline: &gst::Pipeline,
    done: mpsc::Sender<Result<(), String>>,
    out: Out,
) -> Result<(), String> {
    let bus = pipeline.bus().ok_or("no bus")?;
    let weak = pipeline.downgrade();
    thread::Builder::new()
        .name("recording-bus".into())
        .spawn(move || {
            while weak.upgrade().is_some() {
                let Some(message) = bus.timed_pop(gst::ClockTime::from_mseconds(250)) else {
                    continue;
                };
                match message.view() {
                    gst::MessageView::Eos(_) => {
                        let _ = done.send(Ok(()));
                        break;
                    }
                    gst::MessageView::Error(error) => {
                        let text = error.error().to_string();
                        out.event("recording-error", &text);
                        let _ = done.send(Err(text));
                        break;
                    }
                    _ => {}
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}
