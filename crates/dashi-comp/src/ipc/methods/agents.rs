//! Who may do what, and what agents do (docs/compositor-ipc.md, "Capture and
//! agents", "Secrets for agents", "Clipboard history and snippets").

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{Ask, done};
use crate::{
    backend,
    ipc::{
        grants::{Grants, IpcClients},
        protocol::{Done, WindowId},
    },
    render::mask::CaptureMask,
    session::{
        self,
        agent_input::AgentInput,
        applets::AppletClientsParams,
        origin::{Origin, OriginParams},
    },
    state::Dashi,
};

/// The keywords the compositor watches for (`[]` stops it).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Snippets {
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SnippetErase {
    pub window: WindowId,
    pub keyword: String,
}

/// The executables allowed to use screencopy (absolute paths).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ScreencopyClients {
    pub paths: Vec<String>,
}

pub(crate) fn agent_input(state: &mut Dashi, _: &Ask, params: AgentInput) -> Result<Done, String> {
    let result = state.agent_input(&params);
    if result.is_ok() {
        // The screens may be dark (the person away): its window still shows what it did.
        backend::udev::agent_acted(state);
    }
    done(result)
}

pub(crate) fn capture_mask(
    state: &mut Dashi,
    _: &Ask,
    params: CaptureMask,
) -> Result<Done, String> {
    done(state.set_capture_mask(&params))
}

pub(crate) fn input_origin(
    state: &mut Dashi,
    _: &Ask,
    params: OriginParams,
) -> Result<Origin, String> {
    let target = session::origin::parse_target(&params)?;
    Ok(state.origins.describe(&target, std::time::Instant::now()))
}

pub(crate) fn snippets(state: &mut Dashi, _: &Ask, params: Snippets) -> Result<Done, String> {
    done(state.keys.snippets.set(&params.keywords))
}

pub(crate) fn snippet_erase(
    state: &mut Dashi,
    _: &Ask,
    params: SnippetErase,
) -> Result<Done, String> {
    done(state.erase_snippet(params.window.0, &params.keyword))
}

pub(crate) fn screencopy_clients(
    state: &mut Dashi,
    _: &Ask,
    params: ScreencopyClients,
) -> Result<Done, String> {
    let paths: Vec<PathBuf> = params
        .paths
        .iter()
        .map(PathBuf::from)
        .map(|path| path.is_absolute().then_some(path))
        .collect::<Option<_>>()
        .ok_or("`paths` must be absolute paths")?;
    if let Ok(mut granted) = state.screencopy_paths.lock() {
        *granted = paths;
    }
    Ok(Done {})
}

pub(crate) fn applet_clients(
    state: &mut Dashi,
    _: &Ask,
    params: AppletClientsParams,
) -> Result<Done, String> {
    let list = session::applets::AppletClients::parse(&params)?;
    state.applet_clients.set(list);
    state.close_ungranted_layers();
    Ok(Done {})
}

pub(crate) fn ipc_clients(state: &mut Dashi, _: &Ask, params: IpcClients) -> Result<Done, String> {
    state.ipc.grants = Grants::parse(&params)?;
    Ok(Done {})
}
