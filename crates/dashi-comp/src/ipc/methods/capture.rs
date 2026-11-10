//! `capture {path, window?, rect?, output?, cursor?, mask?}`: a picture of a
//! window, a rect, or a screen, saved as a PNG (docs/compositor-ipc.md, "Capture
//! and agents"). The picture is read back on the event loop (the GPU is
//! there); it is encoded and written on a thread of its own, and the reply
//! goes out when the file is on disk.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::Ask;
use crate::{
    backend, background,
    ipc::params::{int, text, window},
    render::{self, capture::Picture},
    state::Dashi,
    wm::valid_frame,
};

pub(crate) fn capture(state: &mut Dashi, ask: &Ask) -> Result<(), String> {
    let params = &ask.params;
    // A mask named but never set blanks nothing; one that is set, what it covers.
    let mask = match params.get("mask") {
        None | Some(Value::Null) => None,
        Some(_) => Some(text(params, "mask")?.to_owned()),
    };
    let path = render::capture_file::check_path(text(params, "path")?)?.to_owned();
    let (area, output, only) = if params.contains_key("window") {
        let id = window(params)?;
        let window = state
            .windows
            .get(id)
            .filter(|entry| entry.announced)
            .map(|entry| entry.window.clone())
            .ok_or_else(|| format!("no window {id}"))?;
        let (frame, output) = render::capture::window_area(state, &window)?;
        (frame, output, Some(window))
    } else if let Some(Value::Object(rect)) = params.get("rect") {
        let rect = valid_frame(
            int(rect, "x")?,
            int(rect, "y")?,
            int(rect, "width")?,
            int(rect, "height")?,
        )
        .ok_or("`rect` needs x, y, and a positive width and height")?;
        let center = rect.loc.to_f64() + rect.size.to_f64().downscale(2.0).to_point();
        let output = state
            .space
            .output_under(center)
            .next()
            .cloned()
            .ok_or("`rect` is not on a screen")?;
        let screen = state.space.output_geometry(&output).ok_or("no screen")?;
        (
            rect.intersection(screen)
                .ok_or("`rect` is not on a screen")?,
            output,
            None,
        )
    } else if let Some(name) = params.get("output") {
        let name = name.as_str().ok_or("`output` must be a screen's name")?;
        let mirrored = state.mirrors.targets().find(|o| o.name() == name).cloned();
        if let Some(target) = mirrored {
            // What a mirroring screen shows: its source's picture, at its own pixels.
            if mask.is_some() {
                return Err("a screen that mirrors another can't be masked".into());
            }
            let cursor = params.get("cursor").and_then(Value::as_bool) == Some(true);
            let picture = backend::capture_mirror(state, &target, cursor)?;
            return save_later(state, ask, path, picture, 1.0);
        }
        let output = state
            .space
            .outputs()
            .find(|o| o.name() == name)
            .cloned()
            .ok_or_else(|| format!("no screen {name:?}"))?;
        (
            state.space.output_geometry(&output).ok_or("no screen")?,
            output,
            None,
        )
    } else {
        let output = state.output_under_pointer().ok_or("no screen")?;
        (
            state.space.output_geometry(&output).ok_or("no screen")?,
            output,
            None,
        )
    };
    let scale = output.current_scale().fractional_scale();
    // The pointer (and what it drags) only when asked, and never in a window's picture.
    let cursor = only.is_none() && params.get("cursor").and_then(Value::as_bool) == Some(true);
    let view = render::View {
        area,
        scale: scale.into(),
        output: &output,
        cursor,
        only,
        decor_scale: None,
    };
    let mut picture = backend::capture(state, &view)?;
    if let Some(name) = &mask {
        state.apply_mask(state.capture_masks.named(name), area, scale, &mut picture);
    }
    save_later(state, ask, path, picture, scale)
}

/// Save `picture` at `path` on a thread, then answer `ask` with its size.
fn save_later(
    state: &mut Dashi,
    ask: &Ask,
    path: PathBuf,
    picture: Picture,
    scale: f64,
) -> Result<(), String> {
    let (connection, id) = (ask.connection, ask.id);
    let answer = json!({ "width": picture.width, "height": picture.height, "scale": scale });
    #[expect(
        clippy::disallowed_methods,
        reason = "runs on the capture worker thread (background::run), off the loop"
    )]
    let save = move || render::capture_file::save_png(&path, &picture);
    background::run(
        &state.loop_handle,
        "capture",
        save,
        move |state: &mut Dashi, saved| state.ipc.reply(connection, id, saved.map(|()| answer)),
    )
}
