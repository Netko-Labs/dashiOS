//! Frosted glass (decisions.md D710 to D719, D730 to D749): the compositor
//! blurs what is behind a pane and draws its material over it. Who has glass,
//! what each material looks like and whether it is frosted, the wallpaper
//! only or solid is the shell's (IPC `glass-style`, `glass-clients`); where
//! the panes are is the client's (ext-background-effect-v1 and dashi_glass_v1,
//! protocols/) or, for the shell's own panes, IPC `glass`. Rust displays,
//! TypeScript decides: nothing here chooses whether there is glass.
//!
//! - style.rs: the levels' looks and the mode; params.rs: the shell's panes.
//! - clients.rs: who is granted; surfaces.rs: a client surface's committed panes.
//! - place.rs: panes as elements, behind their surfaces; element.rs: one pane.
//! - frost.rs, cache.rs: what is behind each pane, drawn small and blurred,
//!   again only when it changed, once for a run of panes side by side
//!   (group.rs); kawase.rs, gl.rs, shaders.rs: the blur and look.
//! - tone.rs: the backdrop's colour, for the words on glass; screen.rs: a
//!   screen's frosting, and where its tones go.
//! - stats.rs: what it costs, in dashi.log with `DASHI_GLASS_STATS=1`.

mod announce;
mod backdrop;
mod cache;
pub(crate) mod clients;
mod element;
mod frost;
mod gl;
#[cfg(test)]
mod gpu_material_tests;
#[cfg(test)]
mod gpu_tests;
mod group;
mod kawase;
mod params;
mod place;
mod screen;
mod shaders;
mod stats;
pub(crate) mod style;
pub(crate) mod surfaces;
mod tone;

use std::collections::HashMap;

use smithay::reexports::{
    wayland_protocols::ext::background_effect::v1::server::ext_background_effect_manager_v1::ExtBackgroundEffectManagerV1,
    wayland_server::{Weak, protocol::wl_surface::WlSurface},
};

pub(crate) use clients::GlassClients;
pub(crate) use element::{Clip, GlassElement};
pub(crate) use frost::frost;
use params::Pane;
pub(crate) use params::{GlassParams, GlassReply};
pub(crate) use screen::{frost_capture, frost_screen};
pub(crate) use stats::Stats;
pub(crate) use style::{GlassStyleParams, Level, Style};

use crate::protocols::dashi_chrome::generated::dashi_glass_v1::DashiGlassV1;

/// The shell's panes and style, the grants, and the protocol objects that hear about them.
#[derive(Default)]
pub(crate) struct Glass {
    panes: HashMap<String, Vec<Pane>>,
    /// The looks and the mode (`glass-style`); none: no client's glass is drawn.
    pub style: Option<Style>,
    pub clients: clients::Clients,
    /// ext_background_effect_manager_v1s bound (they hear the capabilities).
    pub managers: Vec<Weak<ExtBackgroundEffectManagerV1>>,
    /// Surfaces with an ext_background_effect_surface_v1.
    pub effects: Vec<WlSurface>,
    /// dashi_glass_v1 objects, by surface (they hear `drawing` and `tone`).
    pub objects: Vec<(Weak<WlSurface>, DashiGlassV1)>,
    /// The last tone sent for a surface (0xRRGGBB), by its id: a new dashi_glass_v1 hears it at once.
    pub tones: HashMap<smithay::reexports::wayland_server::backend::ObjectId, u32>,
    /// What each manager and object last heard (drawn or not), by object id.
    pub said: HashMap<smithay::reexports::wayland_server::backend::ObjectId, bool>,
    /// False once a GPU could not compile the shaders.
    pub works: bool,
    tried: bool,
    pub stats: Stats,
}

impl Glass {
    /// IPC `glass {namespace, panes}`.
    pub(crate) fn set(&mut self, params: &GlassParams) -> Result<(), String> {
        let panes = params::parse(params)?;
        if panes.is_empty() {
            self.panes.remove(&params.namespace);
        } else {
            self.panes.insert(params.namespace.clone(), panes);
        }
        Ok(())
    }

    /// Whether frosting can be counted on, as far as is known (until a GPU tried, yes).
    pub(crate) fn can(&self) -> bool {
        !self.tried || self.works
    }

    /// A frosting went (or did not).
    pub(crate) fn tried(&mut self, worked: bool) {
        self.tried = true;
        self.works = worked;
    }

    /// How many layers of glass a pane may have under it before it is drawn solid.
    pub(crate) fn deepest(&self) -> usize {
        self.style.as_ref().map_or(usize::MAX, |style| style.depth)
    }
}
