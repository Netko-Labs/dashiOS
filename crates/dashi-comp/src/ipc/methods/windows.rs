//! The session and its windows (docs/compositor-ipc.md, "Session and windows").

use serde::{Deserialize, Serialize};
use smithay::utils::Point;

use super::{Ask, done};
use crate::{
    ipc::protocol::{At, Coord, Count, Done, Nothing, Rect, Wide, Window, WindowId},
    keys::{Chord, TypeText},
    state::Dashi,
    wm::{Shown, valid_frame},
    xwayland::XState,
};

/// Params naming one window.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OneWindow {
    pub window: WindowId,
}

/// Params turning something on or off for one window.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Switch {
    pub window: WindowId,
    pub on: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Session {
    pub wayland_display: String,
    pub display: Option<String>,
    pub xwayland: XState,
    pub pointer: Option<At>,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Windows {
    pub windows: Vec<Window>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Place {
    pub window: WindowId,
    pub x: Coord,
    pub y: Coord,
    pub space: Option<Count>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FrameParams {
    pub window: WindowId,
    pub x: Wide,
    pub y: Wide,
    pub width: Wide,
    pub height: Wide,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default)]
    pub tiled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SendKeys {
    pub window: WindowId,
    pub chord: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnimationTargets {
    pub targets: Vec<AnimationTarget>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AnimationTarget {
    pub window: WindowId,
    /// Where it shrinks to; null forgets it.
    pub rect: Option<Rect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Handle {
    pub handle: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MaybeWindow {
    pub window: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Attach {
    pub window: WindowId,
    pub parent: Option<WindowId>,
    /// How far below the top of its parent's frame (0 to 512; kept within).
    pub top: Option<Coord>,
}

pub(crate) fn subscribe(state: &mut Dashi, ask: &Ask, _: Nothing) -> Result<Done, String> {
    state.ipc.subscribe(ask.connection);
    Ok(Done {})
}

pub(crate) fn session(state: &mut Dashi, _: &Ask, _: Nothing) -> Result<Session, String> {
    let pointer = state.seat.get_pointer().map(|pointer| {
        let at = pointer.current_location();
        At { x: at.x, y: at.y }
    });
    Ok(Session {
        wayland_display: state.socket_name.to_string_lossy().into_owned(),
        display: state.xwayland.display.map(|n| format!(":{n}")),
        xwayland: state.xwayland.state,
        pointer,
        locked: state.lock.locked,
    })
}

pub(crate) fn windows(state: &mut Dashi, _: &Ask, _: Nothing) -> Result<Windows, String> {
    Ok(Windows {
        windows: state.windows.describe_all(state),
    })
}

pub(crate) fn focus(state: &mut Dashi, _: &Ask, params: OneWindow) -> Result<Done, String> {
    done(state.focus_window(params.window.0))
}

pub(crate) fn close(state: &mut Dashi, _: &Ask, params: OneWindow) -> Result<Done, String> {
    done(state.close_window(params.window.0))
}

pub(crate) fn minimize(state: &mut Dashi, _: &Ask, params: OneWindow) -> Result<Done, String> {
    done(state.park_window(params.window.0, Shown::Minimized))
}

pub(crate) fn hide(state: &mut Dashi, _: &Ask, params: OneWindow) -> Result<Done, String> {
    done(state.park_window(params.window.0, Shown::Hidden))
}

pub(crate) fn suspend(state: &mut Dashi, _: &Ask, params: Switch) -> Result<Done, String> {
    done(state.suspend_window(params.window.0, params.on))
}

pub(crate) fn place(state: &mut Dashi, _: &Ask, params: Place) -> Result<Done, String> {
    let at = Point::from((params.x.i32(), params.y.i32()));
    let space = params.space.map(Count::to::<usize>);
    done(state.place_window(params.window.0, at, space))
}

pub(crate) fn frame(state: &mut Dashi, _: &Ask, params: FrameParams) -> Result<Done, String> {
    let frame = valid_frame(
        params.x.get(),
        params.y.get(),
        params.width.get(),
        params.height.get(),
    )
    .ok_or("frame: x, y, width, and height are required (a positive size, within range)")?;
    done(state.frame_window(params.window.0, frame, params.maximized, params.tiled))
}

pub(crate) fn fullscreen(state: &mut Dashi, _: &Ask, params: Switch) -> Result<Done, String> {
    done(state.set_fullscreen(params.window.0, params.on))
}

pub(crate) fn send_keys(state: &mut Dashi, _: &Ask, params: SendKeys) -> Result<Done, String> {
    // Nothing is typed into a window while locked (session/lock.rs).
    if state.lock.locked {
        return Err("the screen is locked".into());
    }
    let chord = Chord::parse(&params.chord)?;
    state.focus_window(params.window.0)?;
    let time = u32::try_from(state.start_time.elapsed().as_millis()).unwrap_or(u32::MAX);
    if state.tap(&chord, None, false, time) {
        Ok(Done {})
    } else {
        Err(format!(
            "send-keys: {:?} cannot be typed on this keyboard",
            params.chord
        ))
    }
}

/// `type-text`: refused in a word the shell acts on (`left-window`, `x11`, `keys-down`).
pub(crate) fn type_text(state: &mut Dashi, _: &Ask, params: TypeText) -> Result<Done, String> {
    done(state.type_text(&params))
}

pub(crate) fn animation_target(
    state: &mut Dashi,
    _: &Ask,
    params: AnimationTargets,
) -> Result<Done, String> {
    state.set_animation_targets(&params.targets);
    Ok(Done {})
}

pub(crate) fn layer_motion(
    state: &mut Dashi,
    _: &Ask,
    params: crate::wm::LayerMotionParams,
) -> Result<Done, String> {
    done(state.layer_motion.set(&params))
}

pub(crate) fn attach(state: &mut Dashi, _: &Ask, params: Attach) -> Result<Done, String> {
    let parent = params.parent.map(|parent| parent.0);
    let top = params.top.map(|top| top.i32().clamp(0, 512));
    done(state.attach_sheet(params.window.0, parent, top))
}

pub(crate) fn window_for_handle(
    state: &mut Dashi,
    _: &Ask,
    params: Handle,
) -> Result<MaybeWindow, String> {
    Ok(MaybeWindow {
        window: find_handle(state, &params.handle),
    })
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
