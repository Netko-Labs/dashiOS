//! Spaces, the overview, and live pictures (docs/compositor-ipc.md, "Spaces and
//! overview", "Live pictures").

use serde::{Deserialize, Serialize};

use super::{Ask, done};
use crate::{
    ipc::protocol::{
        Count, Done, Finite, Int, OverviewParams, SpacePreviews, SpacesAnswer, WindowId,
        WindowThumbnails,
    },
    state::Dashi,
    wm::MAX_SPACES,
};

/// A Space's index (they are counted from 0, at most `MAX_SPACES`).
type Space = Int<0, { MAX_SPACES as i64 - 1 }>;

/// How many Spaces, whether switching follows the focused window, and the Spaces a window's
/// own activation never switches to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpacesParams {
    pub count: Option<Count>,
    pub follow: Option<bool>,
    pub quiet: Option<Vec<Space>>,
}

/// Where a new Space goes (the end when absent).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpaceAdd {
    pub at: Option<Count>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OneSpace {
    pub space: Space,
}

/// Go to a Space (part of the way, following a swipe), carrying a window along.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpaceSwitch {
    pub space: Space,
    pub progress: Option<Finite>,
    pub carry: Option<WindowId>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpaceMove {
    pub window: WindowId,
    pub space: Space,
}

pub(crate) fn spaces(
    state: &mut Dashi,
    _: &Ask,
    params: SpacesParams,
) -> Result<SpacesAnswer, String> {
    if let Some(quiet) = params.quiet {
        state.spaces.quiet = quiet.into_iter().map(|space| space.to::<usize>()).collect();
    }
    state.configure_spaces(params.count.map(Count::to::<usize>), params.follow)
}

pub(crate) fn space_add(
    state: &mut Dashi,
    _: &Ask,
    params: SpaceAdd,
) -> Result<SpacesAnswer, String> {
    state.add_space(params.at.map(Count::to::<usize>))
}

pub(crate) fn space_remove(
    state: &mut Dashi,
    _: &Ask,
    params: OneSpace,
) -> Result<SpacesAnswer, String> {
    state.remove_space(params.space.to::<usize>())
}

pub(crate) fn space_switch(
    state: &mut Dashi,
    _: &Ask,
    params: SpaceSwitch,
) -> Result<SpacesAnswer, String> {
    state.switch_space(
        params.space.to::<usize>(),
        params.progress.map(Finite::get),
        params.carry.map(|carry| carry.0),
    )
}

pub(crate) fn space_move(state: &mut Dashi, _: &Ask, params: SpaceMove) -> Result<Done, String> {
    done(state.move_to_space(params.window.0, params.space.to::<usize>()))
}

pub(crate) fn overview(state: &mut Dashi, _: &Ask, params: OverviewParams) -> Result<Done, String> {
    done(state.overview_request(&params))
}

pub(crate) fn space_previews(
    state: &mut Dashi,
    _: &Ask,
    params: SpacePreviews,
) -> Result<Done, String> {
    done(state.set_space_previews(&params))
}

pub(crate) fn window_thumbnails(
    state: &mut Dashi,
    _: &Ask,
    params: WindowThumbnails,
) -> Result<Done, String> {
    done(state.set_window_thumbnails(&params))
}
