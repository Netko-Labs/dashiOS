//! `capture-mask`: what is blanked in the pictures a client gets, like
//! Android's FLAG_SECURE but only for that client. The shell decides what
//! (password fields, consent sheets, the vault's windows, a window handed to
//! the person) and for whom (its agents' screenshots, by name, and the
//! screencopy clients it started for them, by pid); this paints those areas
//! opaque in the picture before anyone sees it, where it is drawn: in its
//! frame, small in the overview, flying to the Dock, sliding with its Space
//! (drawn.rs), and in any live picture of the shell's that shows it
//! (thumbnails/), which is blanked whole. A window's popups may be blanked
//! without the window (after Dashi typed a card or a password into it: a
//! browser's "save this card?" prompt), and a popup blanked once stays
//! blanked while it lives. A field's blank stops where an opaque window in
//! front covers it (mask_cover.rs).

mod blank;
mod rects;

use std::collections::HashMap;

use smithay::{
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Rectangle},
};

use super::capture::Picture;
pub(crate) use super::mask_params::CaptureMask;
use super::mask_params::parse;
use crate::state::Dashi;
pub(crate) use blank::blank;
pub(super) use blank::outward;

#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Mask {
    /// Whole windows (and their popups and title bars).
    pub windows: Vec<u64>,
    /// Rectangles, in a window's content coordinates when `window` is set, else global.
    pub rects: Vec<(Option<u64>, Rectangle<i32, Logical>)>,
    /// Shell layer surfaces, by namespace (`dashi.agent-consent`).
    pub layers: Vec<String>,
    /// Screencopy and image-copy clients whose frames get this mask.
    pub pids: Vec<u32>,
    /// Windows whose popups are blanked (not the windows).
    pub popups: Vec<u64>,
    /// Popups blanked by an earlier request, kept blanked while they live.
    pub kept: Vec<WlSurface>,
}

impl Mask {
    pub(super) fn is_empty(&self) -> bool {
        self.windows.is_empty()
            && self.rects.is_empty()
            && self.layers.is_empty()
            && self.popups.is_empty()
            && self.kept.is_empty()
    }
}

/// Every client's mask, by the name the shell gave it ("agent").
#[derive(Default)]
pub(crate) struct Masks(HashMap<String, Mask>);

impl Masks {
    pub(crate) fn named(&self, name: &str) -> Option<&Mask> {
        self.0.get(name)
    }

    pub(crate) fn for_pid(&self, pid: u32) -> Option<&Mask> {
        self.0.values().find(|mask| mask.pids.contains(&pid))
    }
}

impl Dashi {
    pub(crate) fn set_capture_mask(&mut self, params: &CaptureMask) -> Result<(), String> {
        let (client, mut mask) = parse(params)?;
        // The popups blanked before stay blanked while they live, and so do those blanked now.
        let mut kept = self
            .capture_masks
            .0
            .get(&client)
            .map(|old| old.kept.clone())
            .unwrap_or_default();
        kept.retain(Resource::is_alive);
        for id in &mask.popups {
            for (surface, _) in self.popup_rects(*id) {
                if !kept.contains(&surface) {
                    kept.push(surface);
                }
            }
        }
        let over = kept.len().saturating_sub(super::mask_params::MAX_ENTRIES);
        kept.drain(..over);
        mask.kept = kept;
        if mask.is_empty() && mask.pids.is_empty() {
            self.capture_masks.0.remove(&client);
        } else {
            self.capture_masks.0.insert(client, mask);
        }
        Ok(())
    }

    /// A screencopy or image-copy frame for `client`: blanked if the shell
    /// masked that client's process (a recorder it started for an agent).
    pub(crate) fn mask_for_client(
        &self,
        client: Option<smithay::reexports::wayland_server::Client>,
        area: Rectangle<i32, Logical>,
        scale: f64,
        picture: &mut Picture,
    ) {
        let pid = client
            .as_ref()
            .and_then(|c| c.get_data::<crate::state::ClientState>())
            .and_then(|data| data.pid())
            .and_then(|pid| u32::try_from(pid).ok());
        if let Some(mask) = pid.and_then(|pid| self.capture_masks.for_pid(pid)) {
            self.apply_mask(Some(mask), area, scale, picture);
        }
    }

    /// Blank what `mask` covers in a picture of `area`.
    pub(crate) fn apply_mask(
        &self,
        mask: Option<&Mask>,
        area: Rectangle<i32, Logical>,
        scale: f64,
        picture: &mut Picture,
    ) {
        let Some(mask) = mask else {
            return;
        };
        let rects = self.mask_rects(mask);
        blank(picture, area, scale, Some(&rects));
    }
}
