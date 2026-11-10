//! Who may do what, and what agents do (docs/compositor-ipc.md, "Capture and
//! agents", "Secrets for agents", "Clipboard history and snippets").

use serde_json::{Value, json};

use super::{Ask, done};
use crate::{
    backend,
    ipc::{
        grants::Grants,
        params::{text, window},
    },
    session,
    state::Dashi,
};

pub(crate) fn agent_input(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let result = state.agent_input(&ask.params);
    if result.is_ok() {
        // The screens may be dark (the person away): its window still shows what it did.
        backend::udev::agent_acted(state);
    }
    done(result)
}

pub(crate) fn capture_mask(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_capture_mask(&ask.params))
}

pub(crate) fn input_origin(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let target = session::origin::parse_target(&ask.params)?;
    Ok(state.origins.describe(&target, std::time::Instant::now()))
}

pub(crate) fn snippets(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let keywords = ask
        .params
        .get("keywords")
        .and_then(Value::as_array)
        .ok_or("`keywords` must be a list of strings")?
        .iter()
        .map(|k| {
            k.as_str()
                .map(str::to_owned)
                .ok_or("`keywords` must be a list of strings")
        })
        .collect::<Result<Vec<_>, _>>()?;
    done(state.keys.snippets.set(&keywords))
}

pub(crate) fn snippet_erase(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.erase_snippet(window(&ask.params)?, text(&ask.params, "keyword")?))
}

pub(crate) fn screencopy_clients(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let paths = ask
        .params
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

pub(crate) fn applet_clients(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let list = session::applets::AppletClients::parse(&ask.params)?;
    state.applet_clients.set(list);
    state.close_ungranted_layers();
    Ok(json!({}))
}

pub(crate) fn ipc_clients(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.ipc.grants = Grants::parse(&ask.params)?;
    Ok(json!({}))
}
