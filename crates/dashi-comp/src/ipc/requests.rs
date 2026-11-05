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
    wm::{Shown, valid_frame},
};

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
        "place" => {
            let at = Point::from((coord(params, "x")?, coord(params, "y")?));
            let space = match params.get("space") {
                None => None,
                Some(value) => {
                    Some(value.as_u64().ok_or("`space` must be a Space's index")? as usize)
                }
            };
            done(state.place_window(window(params)?, at, space))
        }
        "frame" => {
            let frame = valid_frame(
                int(params, "x")?,
                int(params, "y")?,
                int(params, "width")?,
                int(params, "height")?,
            )
            .ok_or("frame: x, y, width, and height are required (a positive size, within range)")?;
            let maximized = flag(params, "maximized");
            let tiled = flag(params, "tiled");
            done(state.frame_window(window(params)?, frame, maximized, tiled))
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
        "window-style" => {
            state.window_style = render::depth::style::parse(params)?;
            Ok(json!({}))
        }
        "capture" => capture(state, connection, params),
        "agent-input" => done(state.agent_input(params)),
        // Secrets for agents (0.4.0): blanked captures, and whose presses were whose.
        "capture-mask" => {
            shell_only(state, connection, "capture-mask")?;
            done(state.set_capture_mask(params))
        }
        "input-origin" => {
            let target = session::origin::parse_target(params)?;
            Ok(state.origins.describe(&target, std::time::Instant::now()))
        }
        "idle" => {
            let timeouts = params
                .get("timeouts")
                .and_then(Value::as_array)
                .ok_or("`timeouts` must be a list of seconds")?;
            let timeouts = timeouts
                .iter()
                .map(|t| t.as_u64().ok_or("`timeouts` must be a list of seconds"))
                .collect::<Result<_, _>>()?;
            state.set_idle_timeouts(timeouts);
            Ok(json!({}))
        }
        "power" => {
            let on = params
                .get("on")
                .and_then(Value::as_bool)
                .ok_or("`on` must be true or false")?;
            let only = match params.get("output") {
                None | Some(Value::Null) => None,
                Some(_) => Some(text(params, "output")?),
            };
            backend::udev::power(state, on, flag(params, "reset"), only)?;
            Ok(json!({}))
        }
        "gamma" => {
            let channel = |key: &str| number(params, key).map(|v| v.clamp(0.1, 1.0));
            let tint = [channel("red")?, channel("green")?, channel("blue")?];
            let neutral = tint.iter().all(|c| *c >= 0.999);
            state.backend.set_gamma((!neutral).then_some(tint));
            Ok(json!({}))
        }
        "edges" => {
            let band = coord(params, "bottom")?;
            let output = params
                .get("output")
                .and_then(Value::as_str)
                .map(str::to_owned);
            Ok(json!({ "inside": state.claim_bottom(band, output) }))
        }
        "gestures" => {
            let swipe = params
                .get("swipe")
                .and_then(Value::as_array)
                .ok_or("`swipe` must be a list of finger counts")?;
            state.claim_swipes(
                swipe
                    .iter()
                    .filter_map(Value::as_u64)
                    .map(|f| f as u32)
                    .collect(),
            );
            Ok(json!({}))
        }
        "overview" => state.overview_request(params),
        // Live pictures the shell places (render/thumbnails/).
        "space-previews" => done(state.set_space_previews(params)),
        "window-thumbnails" => done(state.set_window_thumbnails(params)),
        "spaces" => {
            let count = match params.get("count") {
                None => None,
                Some(value) => Some(value.as_u64().ok_or("`count` must be a number")? as usize),
            };
            let follow = match params.get("follow") {
                None => None,
                Some(value) => Some(value.as_bool().ok_or("`follow` must be true or false")?),
            };
            state.configure_spaces(count, follow)
        }
        "space-add" => {
            let at = match params.get("at") {
                None => None,
                Some(value) => Some(value.as_u64().ok_or("`at` must be a Space's index")? as usize),
            };
            state.add_space(at)
        }
        "space-remove" => {
            let space = params
                .get("space")
                .and_then(Value::as_u64)
                .ok_or("`space` must be a Space's index")? as usize;
            state.remove_space(space)
        }
        "space-switch" => {
            let space = params
                .get("space")
                .and_then(Value::as_u64)
                .ok_or("`space` must be a Space's index")? as usize;
            let progress = match params.get("progress") {
                None => None,
                Some(value) => Some(
                    value
                        .as_f64()
                        .filter(|p| p.is_finite())
                        .ok_or("`progress` must be a number")?,
                ),
            };
            let carry = match params.get("carry") {
                None | Some(Value::Null) => None,
                Some(value) => Some(value.as_u64().ok_or("`carry` must be a window id")?),
            };
            state.switch_space(space, progress, carry)
        }
        "space-move" => {
            let space = params
                .get("space")
                .and_then(Value::as_u64)
                .ok_or("`space` must be a Space's index")? as usize;
            done(state.move_to_space(window(params)?, space))
        }
        "fullscreen" => {
            let on = params
                .get("on")
                .and_then(Value::as_bool)
                .ok_or("`on` must be true or false")?;
            done(state.set_fullscreen(window(params)?, on))
        }
        "bars" => {
            let top = params
                .contains_key("top")
                .then(|| coord(params, "top"))
                .transpose()?;
            let show = match params.get("show") {
                None => None,
                Some(show) => {
                    let show = show.as_bool().ok_or("`show` must be true or false")?;
                    let output = params
                        .get("output")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    Some((show, output))
                }
            };
            state.set_bars(top, show);
            Ok(json!({}))
        }
        "wallpaper" => state.set_wallpaper(params),
        "outputs" => Ok(outputs::describe_all(state)),
        "screencopy-clients" => {
            let paths = params
                .get("paths")
                .and_then(Value::as_array)
                .ok_or("`paths` must be a list")?;
            let paths: Vec<std::path::PathBuf> = paths
                .iter()
                .map(|p| {
                    p.as_str()
                        .map(std::path::PathBuf::from)
                        .filter(|p| p.is_absolute())
                        .ok_or("`paths` must be absolute paths")
                })
                .collect::<Result<_, _>>()?;
            if let Ok(mut granted) = state.screencopy_paths.lock() {
                *granted = paths;
            }
            Ok(json!({}))
        }
        "applet-clients" => applet_clients(state, connection, params),
        "layout" => done(state.set_zones(params)),
        "keyboard" => done(state.set_keyboard(params)),
        "input" => done(state.set_input(params)),
        "animation-target" => done(state.set_animation_targets(params)),
        "layer-motion" => done(state.layer_motion.set(params)),
        "outputs-config" => done(state.configure_outputs(params)),
        "output" => {
            let name = text(params, "name")?.to_owned();
            done(outputs::set_scale(state, &name, number(params, "scale")?))
        }
        "xwayland-scale" => done(state.set_xwayland_scale(number(params, "scale")?)),
        "input-region" => done(state.set_layer_region(params)),
        "cursor-size" => {
            let size = number(params, "size")?;
            if !(16.0..=128.0).contains(&size) || size.fract() != 0.0 {
                return Err("cursor-size: `size` must be a whole number from 16 to 128".into());
            }
            state.cursors.set_size(size as u32);
            Ok(json!({}))
        }
        "attach" => {
            let parent = match params.get("parent") {
                None | Some(Value::Null) => None,
                Some(value) => Some(
                    value
                        .as_u64()
                        .filter(|id| *id > 0)
                        .ok_or("`parent` must be a window id or null")?,
                ),
            };
            let top = params
                .contains_key("top")
                .then(|| coord(params, "top"))
                .transpose()?
                .map(|top| top.clamp(0, 512));
            done(state.attach_sheet(window(params)?, parent, top))
        }
        "window-for-handle" => {
            Ok(json!({ "window": window_for_handle(state, text(params, "handle")?) }))
        }
        method => Err(format!("unknown method: {method}")),
    }
}

/// The window a portal's parent handle names: `wayland:<xdg-foreign handle>`
/// or `x11:<X window id in hex>`; None for anything else, or a window gone.
fn window_for_handle(state: &Dashi, handle: &str) -> Option<u64> {
    if let Some(exported) = handle.strip_prefix("wayland:") {
        let surface = state.xdg_foreign.surface_for(exported)?;
        return crate::wm::window_id_for_surface(state, surface);
    }
    let xid = handle.strip_prefix("x11:")?;
    let xid = u32::from_str_radix(xid.trim_start_matches("0x"), 16).ok()?;
    state
        .windows
        .entries()
        .filter(|entry| entry.announced)
        .find(|entry| {
            entry
                .window
                .x11_surface()
                .is_some_and(|x11| x11.window_id() == xid)
        })
        .map(|entry| entry.id)
}

/// Refuse `method` unless the connection is the shell's (the session client or under it).
fn shell_only(state: &Dashi, connection: ConnectionId, method: &str) -> Result<(), String> {
    let from_shell = match (state.ipc.peer_pid(connection), state.session_client) {
        (Some(peer), Some(shell)) => session::trust::descends_from(peer, shell),
        _ => false,
    };
    if from_shell {
        Ok(())
    } else {
        Err(format!("{method} is only for the shell"))
    }
}

/// `applet-clients {applets: [{pid, layerShell}]}`: only the shell may.
fn applet_clients(
    state: &mut Dashi,
    connection: ConnectionId,
    params: &Map<String, Value>,
) -> Result<Value, String> {
    shell_only(state, connection, "applet-clients")?;
    let list = session::applets::AppletClients::parse(params)?;
    state.applet_clients.set(list);
    state.close_ungranted_layers();
    Ok(json!({}))
}

/// `capture {path, window?, rect?, cursor?, mask?}`: only the shell may.
fn capture(
    state: &mut Dashi,
    connection: ConnectionId,
    params: &Map<String, Value>,
) -> Result<Value, String> {
    shell_only(state, connection, "capture")?;
    // A mask named but never set blanks nothing; one that is set, what it covers.
    let mask = match params.get("mask") {
        None | Some(Value::Null) => None,
        Some(_) => Some(text(params, "mask")?.to_owned()),
    };
    let path = render::capture::check_path(text(params, "path")?)?.to_owned();
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
    };
    let mut picture = backend::capture(state, &view)?;
    if let Some(name) = &mask {
        state.apply_mask(state.capture_masks.named(name), area, scale, &mut picture);
    }
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
        "display": state.xwayland.display.map(|n| format!(":{n}")),
        "xwayland": state.xwayland.state.name(),
        "pointer": pointer,
        "locked": state.lock.locked,
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
