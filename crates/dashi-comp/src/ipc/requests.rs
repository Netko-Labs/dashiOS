//! What the shell may ask (docs/compositor-ipc.md, "Requests"). Methods the
//! protocol has but this compositor does not do yet answer so, with their
//! milestone (docs/compositor.md). Params are untrusted: each is checked
//! before anything changes.

use serde_json::{Map, Value, json};
use smithay::utils::Point;

use super::{frame::Request, server::ConnectionId};
use crate::{
    backend,
    keys::{Chord, Keymap},
    outputs, render, session,
    state::Dashi,
    wm::{Shown, frame_of, valid_frame},
};

/// Methods the protocol has that this compositor does not do yet.
const LATER: &[&str] = &[
    "fullscreen",
    "outputs-config",
    "power",
    "gamma",
    "wallpaper",
    "space-add",
    "space-switch",
    "space-move",
    "overview",
    "agent-input",
];

pub(crate) fn handle(
    state: &mut Dashi,
    connection: ConnectionId,
    request: Request,
) -> Result<Value, String> {
    let params = &request.params;
    let done = |result: Result<(), String>| result.map(|()| json!({}));
    match request.method.as_str() {
        "subscribe" => {
            state.ipc.subscribe(connection);
            Ok(json!({}))
        }
        "session" => Ok(session(state)),
        "windows" => Ok(json!({ "windows": state.windows.describe_all(state) })),
        "focus" => done(state.focus_window(window(params)?)),
        "close" => done(state.close_window(window(params)?)),
        "minimize" => done(state.park_window(window(params)?, Shown::Minimized)),
        "hide" => done(state.park_window(window(params)?, Shown::Hidden)),
        "restore" => done(state.restore_window(window(params)?)),
        "place" => {
            let at = Point::from((coord(params, "x")?, coord(params, "y")?));
            done(state.place_window(window(params)?, at))
        }
        "frame" => {
            let frame = valid_frame(
                int(params, "x")?,
                int(params, "y")?,
                int(params, "width")?,
                int(params, "height")?,
            )
            .ok_or("frame: x, y, width, and height are required (a positive size, within range)")?;
            let remember = flag(params, "remember");
            let maximized = flag(params, "maximized");
            done(state.frame_window(window(params)?, frame, remember, maximized))
        }
        "keymap" => {
            state.keys.keymap = Keymap::parse(params)?;
            Ok(json!({}))
        }
        "send-keys" => {
            let id = window(params)?;
            let chord = Chord::parse(text(params, "chord")?)?;
            state.focus_window(id)?;
            let time = state.start_time.elapsed().as_millis() as u32;
            if state.tap(&chord, None, false, time) {
                Ok(json!({}))
            } else {
                Err(format!(
                    "send-keys: {:?} cannot be typed on this keyboard",
                    text(params, "chord")?
                ))
            }
        }
        "chrome" => {
            if let Some(dark) = params.get("dark") {
                state.chrome_style.dark = dark.as_bool().ok_or("`dark` must be true or false")?;
            }
            if params.contains_key("radius") {
                state.chrome_style.radius = coord(params, "radius")?.clamp(0, 32);
            }
            if let Some(reduce) = params.get("reduceMotion") {
                state.chrome_style.reduce_motion = reduce
                    .as_bool()
                    .ok_or("`reduceMotion` must be true or false")?;
            }
            Ok(json!({}))
        }
        "capture" => capture(state, connection, params),
        "outputs" => Ok(outputs::describe_all(state)),
        // One Space until C2.
        "spaces" => Ok(json!({ "count": 1, "current": 0 })),
        // The Dock's edge claim: kept, and not inside until edges work (C2).
        "edges" => {
            state.shell_config.keep("edges", request.params.clone());
            Ok(json!({ "inside": false }))
        }
        method if state.shell_config.keep(method, request.params.clone()) => Ok(json!({})),
        "output" => {
            let name = text(params, "name")?.to_owned();
            done(outputs::set_scale(state, &name, number(params, "scale")?))
        }
        method if LATER.contains(&method) => Err(format!("{method}: not in this dashi-comp yet")),
        method => Err(format!("unknown method: {method}")),
    }
}

/// `capture {path, window?, rect?}`: only the shell may.
fn capture(
    state: &mut Dashi,
    connection: ConnectionId,
    params: &Map<String, Value>,
) -> Result<Value, String> {
    let from_shell = match (state.ipc.peer_pid(connection), state.session_client) {
        (Some(peer), Some(shell)) => session::trust::descends_from(peer, shell),
        _ => false,
    };
    if !from_shell {
        return Err("capture is only for the shell".into());
    }
    let path = render::capture::check_path(text(params, "path")?)?.to_owned();
    let (area, output, only) = if params.contains_key("window") {
        let id = window(params)?;
        let window = state
            .windows
            .get(id)
            .filter(|entry| entry.announced)
            .map(|entry| entry.window.clone())
            .ok_or_else(|| format!("no window {id}"))?;
        let frame = frame_of(state, &window).ok_or("that window is not on screen")?;
        let output = state
            .space
            .output_under(frame.loc.to_f64() + frame.size.to_f64().downscale(2.0).to_point())
            .next()
            .or_else(|| state.space.outputs().next())
            .cloned()
            .ok_or("no screen")?;
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
    } else {
        let output = state.output_under_pointer().ok_or("no screen")?;
        (
            state.space.output_geometry(&output).ok_or("no screen")?,
            output,
            None,
        )
    };
    let scale = output.current_scale().fractional_scale();
    let view = render::View {
        area,
        scale: scale.into(),
        output: &output,
        cursor: false,
        only,
    };
    let picture = backend::capture(state, &view)?;
    render::capture::save_png(&path, &picture)?;
    Ok(json!({ "width": picture.width, "height": picture.height, "scale": scale }))
}

fn session(state: &Dashi) -> Value {
    let pointer = state.seat.get_pointer().map(|pointer| {
        let at = pointer.current_location();
        json!({ "x": at.x, "y": at.y })
    });
    json!({
        "waylandDisplay": state.socket_name.to_string_lossy(),
        "display": null,
        "xwayland": "off",
        "pointer": pointer,
        // The session lock arrives in C3; until then the screen is never locked.
        "locked": false,
    })
}

fn window(params: &Map<String, Value>) -> Result<u64, String> {
    params
        .get("window")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(|| "`window` must be a window id".into())
}

fn int(params: &Map<String, Value>, key: &str) -> Result<i64, String> {
    let value = params
        .get(key)
        .ok_or_else(|| format!("`{key}` is required"))?;
    value
        .as_i64()
        .or_else(|| {
            value
                .as_f64()
                .filter(|v| v.is_finite())
                .map(|v| v.round() as i64)
        })
        .ok_or_else(|| format!("`{key}` must be a number"))
}

fn coord(params: &Map<String, Value>, key: &str) -> Result<i32, String> {
    let value = int(params, key)?;
    i32::try_from(value)
        .ok()
        .filter(|v| v.abs() <= 1 << 16)
        .ok_or_else(|| format!("`{key}` is out of range"))
}

fn number(params: &Map<String, Value>, key: &str) -> Result<f64, String> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("`{key}` must be a number"))
}

fn text<'a>(params: &'a Map<String, Value>, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("`{key}` must be a string"))
}

fn flag(params: &Map<String, Value>, key: &str) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn window_ids_are_positive_integers() {
        assert_eq!(window(&params(json!({ "window": 4 }))), Ok(4));
        assert!(window(&params(json!({ "window": 0 }))).is_err());
        assert!(window(&params(json!({ "window": "4" }))).is_err());
        assert!(window(&params(json!({}))).is_err());
    }

    #[test]
    fn numbers_round_and_coordinates_stay_in_range() {
        assert_eq!(int(&params(json!({ "x": 10.6 })), "x"), Ok(11));
        assert!(int(&params(json!({ "x": "10" })), "x").is_err());
        assert_eq!(coord(&params(json!({ "y": -40 })), "y"), Ok(-40));
        assert!(coord(&params(json!({ "y": 1e12 })), "y").is_err());
        assert!(number(&params(json!({ "scale": null })), "scale").is_err());
    }
}
