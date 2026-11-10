//! `wallpaper`: what the shell asks for, loaded off the loop (a picture's
//! decode on a thread, a video in GStreamer) and shown once it is ready.

use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use smithay::{
    backend::{allocator::Fourcc, renderer::element::memory::MemoryRenderBuffer},
    reexports::calloop::{
        channel,
        timer::{TimeoutAction, Timer},
    },
    utils::{Rectangle, Transform},
};

use crate::{
    ipc::protocol::{Event, WallpaperParams},
    state::Dashi,
};

use super::{
    fit::Mode,
    layer::{Shown, procedural_shown, show_frame},
    procedural::{self, Look},
    video,
};

/// A picture or video path from a request: absolute, and a file that is there.
fn existing_file(value: &str, key: &str) -> Result<PathBuf, String> {
    if value.contains('\0') {
        return Err(format!("`{key}` must be a path"));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(format!("`{key}` must be absolute"));
    }
    if !path.is_file() {
        return Err(format!("{}: no such file", path.display()));
    }
    Ok(path)
}

impl Dashi {
    /// `wallpaper {path, mode} | {gradient, mode} | {shader, fps, mode} | {video, mode} | {paused}`.
    pub(crate) fn set_wallpaper(&mut self, params: &WallpaperParams) -> Result<(), String> {
        if let Some(paused) = params.paused {
            self.wallpaper.paused = paused;
            if let Some(player) = &self.wallpaper.player {
                player.set_paused(paused);
            }
            return Ok(());
        }
        let mode = params.mode.unwrap_or(Mode::Fill);
        if params.gradient == Some(true) {
            self.show_procedural(Look::Gradient, 0, mode);
        } else if let Some(shader) = &params.shader {
            let look = Look::shader(shader).ok_or("`shader` must be aurora, drift, or tide")?;
            let fps = params
                .fps
                .map(|fps| fps.to::<u32>())
                .filter(|f| [15, 30, 60].contains(f))
                .unwrap_or(30);
            self.show_procedural(look, fps, mode);
        } else if let Some(path) = &params.path {
            let path = existing_file(path, "path")?;
            self.load_picture(path, mode);
        } else if let Some(path) = &params.video {
            let path = existing_file(path, "video")?;
            self.play_video(path, mode)?;
        } else {
            return Err("wallpaper needs path, video, gradient, shader, or paused".into());
        }
        Ok(())
    }

    /// Drop whatever drove the old wallpaper (a video, a live look's timer).
    fn replace_wallpaper(&mut self) -> u64 {
        self.wallpaper.generation += 1;
        self.wallpaper.player = None;
        for token in self.wallpaper.sources.drain(..) {
            self.loop_handle.remove(token);
        }
        self.wallpaper.generation
    }

    fn show_procedural(&mut self, look: Look, fps: u32, mode: Mode) {
        self.replace_wallpaper();
        self.wallpaper.mode = mode;
        self.wallpaper.shown = procedural_shown(look, 0.0);
        self.ipc.emit(Event::Wallpaper {
            path: None,
            ok: true,
            error: None,
        });
        if !look.animated() || fps == 0 {
            return;
        }
        let started = Instant::now();
        let frame = Duration::from_secs_f64(1.0 / f64::from(fps));
        let timer =
            self.loop_handle
                .insert_source(Timer::from_duration(frame), move |_, _, state| {
                    if !state.wallpaper.paused {
                        let t = started.elapsed().as_secs_f32();
                        let _ = state.wallpaper.shown.buffer.render().draw(|pixels| {
                            procedural::draw(look, t, pixels);
                            Ok::<_, ()>(vec![Rectangle::from_size(
                                (procedural::WIDTH as i32, procedural::HEIGHT as i32).into(),
                            )])
                        });
                    }
                    TimeoutAction::ToDuration(frame)
                });
        if let Ok(token) = timer {
            self.wallpaper.sources.push(token);
        }
    }

    fn load_picture(&mut self, path: PathBuf, mode: Mode) {
        let generation = self.replace_wallpaper();
        let (sender, receiver) = channel::channel::<Result<(i32, i32, Vec<u8>), String>>();
        let source = path.clone();
        let spawned = std::thread::Builder::new()
            .name("wallpaper-picture".into())
            .spawn(move || {
                #[expect(
                    clippy::disallowed_methods,
                    reason = "runs on the wallpaper-picture thread, off the loop"
                )]
                let decoded =
                    image::open(&source)
                        .map_err(|error| error.to_string())
                        .map(|picture| {
                            let rgba = picture.to_rgba8();
                            (rgba.width() as i32, rgba.height() as i32, rgba.into_raw())
                        });
                let _ = sender.send(decoded);
            });
        if spawned.is_err() {
            return self.wallpaper_failed(&path, "no thread to decode the picture on");
        }
        let token = self
            .loop_handle
            .insert_source(receiver, move |event, _, state| {
                let channel::Event::Msg(decoded) = event else {
                    return;
                };
                if state.wallpaper.generation != generation {
                    return;
                }
                match decoded {
                    Ok((w, h, rgba)) => {
                        let buffer = MemoryRenderBuffer::from_slice(
                            &rgba,
                            Fourcc::Abgr8888,
                            (w, h),
                            1,
                            Transform::Normal,
                            None,
                        );
                        state.wallpaper.shown = Shown {
                            buffer,
                            size: (w, h),
                            follows_mode: true,
                        };
                        state.wallpaper.mode = mode;
                        state.ipc.emit(Event::Wallpaper {
                            path: Some(path.to_string_lossy().into_owned()),
                            ok: true,
                            error: None,
                        });
                    }
                    Err(error) => state.wallpaper_failed(&path, &error),
                }
            });
        if let Ok(token) = token {
            self.wallpaper.sources.push(token);
        }
    }

    fn play_video(&mut self, path: PathBuf, mode: Mode) -> Result<(), String> {
        let generation = self.replace_wallpaper();
        let (frames, frame_source) = channel::sync_channel::<video::Frame>(1);
        let (status, status_source) = channel::channel::<video::Status>();
        let player = video::Player::start(&path, frames, status)?;
        if self.wallpaper.paused {
            player.set_paused(true);
        }
        self.wallpaper.player = Some(player);
        let frame_token = self
            .loop_handle
            .insert_source(frame_source, move |event, _, state| {
                let channel::Event::Msg(frame) = event else {
                    return;
                };
                if state.wallpaper.generation != generation {
                    return;
                }
                state.wallpaper.mode = mode;
                show_frame(&mut state.wallpaper.shown, frame);
            });
        let shown = path.clone();
        let status_token = self
            .loop_handle
            .insert_source(status_source, move |event, _, state| {
                let channel::Event::Msg(status) = event else {
                    return;
                };
                if state.wallpaper.generation != generation {
                    return;
                }
                match status {
                    video::Status::Playing => state.ipc.emit(Event::Wallpaper {
                        path: Some(shown.to_string_lossy().into_owned()),
                        ok: true,
                        error: None,
                    }),
                    video::Status::Failed(error) => {
                        state.wallpaper.player = None;
                        state.wallpaper_failed(&shown, &error);
                    }
                }
            });
        self.wallpaper.sources.extend(frame_token.ok());
        self.wallpaper.sources.extend(status_token.ok());
        Ok(())
    }

    fn wallpaper_failed(&mut self, path: &Path, error: &str) {
        tracing::warn!(path = %path.display(), error, "the wallpaper could not be shown");
        self.ipc.emit(Event::Wallpaper {
            path: Some(path.to_string_lossy().into_owned()),
            ok: false,
            error: Some(error.to_string()),
        });
    }
}
