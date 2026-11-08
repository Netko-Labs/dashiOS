//! dashi-camera: the webcam for Dashi (docs/camera.md). The shell starts it
//! when something needs the camera (the Camera app, an agent's take_photo or
//! record_video) and talks to it on stdin and stdout, one JSON object per line
//! (protocol.rs). It opens the camera through PipeWire, publishes the preview
//! as a PipeWire video stream the compositor draws into the Camera window
//! (IPC `video-views`), saves photos, and records video with the Radeon's
//! encoder when it has one. It decides nothing: which camera, where files go,
//! and who may ask are the shell's. When stdin closes (the shell went), it
//! finishes any recording, lets the camera go, and exits.

mod camera;
mod encoders;
mod out;
mod protocol;
mod recording;
mod still;

use std::{io::BufRead, time::Duration};

use gstreamer as gst;
use serde_json::{Value, json};

use camera::Camera;
use out::Out;
use protocol::Request;
use recording::Recording;

/// How long the camera has to send its first picture.
const FIRST_FRAME: Duration = Duration::from_secs(8);

#[derive(Default)]
struct Service {
    out: Out,
    camera: Option<Camera>,
    recording: Option<Recording>,
}

impl Service {
    fn camera(&self) -> Result<&Camera, String> {
        self.camera
            .as_ref()
            .ok_or_else(|| "the camera is not open".to_string())
    }

    fn handle(&mut self, request: Request) -> Result<Value, String> {
        match request {
            Request::Open { camera, preview } => {
                self.close();
                let opened = Camera::open(&camera, &preview, self.out.clone())?;
                let frame = opened.latest(FIRST_FRAME)?;
                self.camera = Some(opened);
                Ok(json!({ "width": frame.width, "height": frame.height, "preview": preview }))
            }
            Request::Close => {
                let stopped = self.finish();
                self.camera = None;
                Ok(
                    json!({ "recording": stopped.ok().map(|(path, seconds)| json!({ "path": path, "seconds": seconds })) }),
                )
            }
            Request::Photo { path, poster } => {
                let frame = self.camera()?.latest(Duration::from_secs(2))?;
                still::save_photo(&frame, &path)?;
                // A missing poster costs only the thumbnail.
                let poster = still::save_poster(&frame, &poster).ok().map(|()| poster);
                Ok(
                    json!({ "path": path, "poster": poster, "width": frame.width, "height": frame.height }),
                )
            }
            Request::Record {
                path,
                poster,
                microphone,
            } => {
                if self.recording.is_some() {
                    return Err("already recording".into());
                }
                let camera = self.camera()?;
                let caps = camera.tap_caps(Duration::from_secs(2))?;
                let frame = camera.latest(Duration::from_secs(2))?;
                let (recording, chosen) =
                    Recording::start(&path, &caps, microphone, self.out.clone())?;
                camera.feed(Some(recording.src()));
                self.recording = Some(recording);
                let poster = still::save_poster(&frame, &poster).ok().map(|()| poster);
                Ok(json!({
                    "path": path,
                    "poster": poster,
                    "video": chosen.video.element,
                    "hardware": chosen.video.hardware,
                    "audio": chosen.audio,
                }))
            }
            Request::Stop => {
                let (path, seconds) = self.finish()?;
                Ok(json!({ "path": path, "seconds": seconds }))
            }
            Request::Encoders => {
                let chosen = recording::choose()?;
                Ok(
                    json!({ "video": chosen.video.element, "hardware": chosen.video.hardware, "audio": chosen.audio }),
                )
            }
        }
    }

    /// Ends a recording in progress, finishing its file.
    fn finish(&mut self) -> Result<(std::path::PathBuf, f64), String> {
        let recording = self.recording.take().ok_or("not recording")?;
        if let Some(camera) = &self.camera {
            camera.feed(None);
        }
        recording.stop()
    }

    fn close(&mut self) {
        let _ = self.finish();
        self.camera = None;
    }
}

fn main() {
    if let Err(error) = gst::init() {
        eprintln!("dashi-camera: GStreamer: {error}");
        std::process::exit(1);
    }
    let mut service = Service::default();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let reply = match protocol::parse(&line) {
            Ok((id, request)) => protocol::reply(id, service.handle(request)),
            Err((Some(id), error)) => protocol::reply(id, Err(error)),
            Err((None, error)) => protocol::event("bad-request", &error),
        };
        service.out.send(&reply);
    }
    service.close();
}
