//! The session and its windows (docs/compositor-ipc.md, "Session and windows").

use serde_json::{Value, json};
use smithay::utils::Point;

use super::{Ask, done};
use crate::{
    ipc::params::{coord, flag, index, int, on, text, window},
    keys::Chord,
    state::Dashi,
    wm::{Shown, valid_frame},
};

pub(crate) fn subscribe(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.ipc.subscribe(ask.connection);
    Ok(json!({}))
}

pub(crate) fn session(state: &mut Dashi, _: &Ask) -> Result<Value, String> {
    let pointer = state.seat.get_pointer().map(|pointer| {
        let at = pointer.current_location();
        json!({ "x": at.x, "y": at.y })
    });
    Ok(json!({
        "waylandDisplay": state.socket_name.to_string_lossy(),
        "display": state.xwayland.display.map(|n| format!(":{n}")),
        "xwayland": state.xwayland.state.name(),
        "pointer": pointer,
        "locked": state.lock.locked,
    }))
}

pub(crate) fn windows(state: &mut Dashi, _: &Ask) -> Result<Value, String> {
    Ok(json!({ "windows": state.windows.describe_all(state) }))
}

pub(crate) fn focus(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.focus_window(window(&ask.params)?))
}

pub(crate) fn close(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.close_window(window(&ask.params)?))
}

pub(crate) fn minimize(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.park_window(window(&ask.params)?, Shown::Minimized))
}

pub(crate) fn hide(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.park_window(window(&ask.params)?, Shown::Hidden))
}

pub(crate) fn suspend(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let on = on(&ask.params, "on")?;
    done(state.suspend_window(window(&ask.params)?, on))
}

pub(crate) fn place(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
    let at = Point::from((coord(params, "x")?, coord(params, "y")?));
    let space = index(params, "space", "a Space's index")?;
    done(state.place_window(window(params)?, at, space))
}

pub(crate) fn frame(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
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

pub(crate) fn fullscreen(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let on = on(&ask.params, "on")?;
    done(state.set_fullscreen(window(&ask.params)?, on))
}

pub(crate) fn send_keys(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    // Nothing is typed into a window while locked (session/lock.rs).
    if state.lock.locked {
        return Err("the screen is locked".into());
    }
    let params = &ask.params;
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

pub(crate) fn animation_target(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_animation_targets(&ask.params))
}

pub(crate) fn layer_motion(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.layer_motion.set(&ask.params))
}

pub(crate) fn attach(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
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

pub(crate) fn window_for_handle(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let handle = text(&ask.params, "handle")?;
    Ok(json!({ "window": find_handle(state, handle) }))
}

/// The window a portal's parent handle names: `wayland:<xdg-foreign handle>`
/// or `x11:<X window id in hex>`; None for anything else, or a window gone.
fn find_handle(state: &Dashi, handle: &str) -> Option<u64> {
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
