//! Spaces, the overview, and live pictures (docs/compositor-ipc.md, "Spaces and
//! overview", "Live pictures").

use serde_json::Value;

use super::{Ask, done};
use crate::{
    ipc::params::{index, space, window},
    state::Dashi,
};

pub(crate) fn spaces(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let count = index(&ask.params, "count", "a number")?;
    let follow = match ask.params.get("follow") {
        None => None,
        Some(value) => Some(value.as_bool().ok_or("`follow` must be true or false")?),
    };
    state.configure_spaces(count, follow)
}

pub(crate) fn space_add(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.add_space(index(&ask.params, "at", "a Space's index")?)
}

pub(crate) fn space_remove(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.remove_space(space(&ask.params)?)
}

pub(crate) fn space_switch(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
    let space = space(params)?;
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

pub(crate) fn space_move(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let space = space(&ask.params)?;
    done(state.move_to_space(window(&ask.params)?, space))
}

pub(crate) fn overview(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.overview_request(&ask.params)
}

pub(crate) fn space_previews(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_space_previews(&ask.params))
}

pub(crate) fn window_thumbnails(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_window_thumbnails(&ask.params))
}
