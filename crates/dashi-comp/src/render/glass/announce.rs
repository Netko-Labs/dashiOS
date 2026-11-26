//! Whether a client's glass is drawn, and telling every client when that
//! changes: the style arrived or changed mode, the grants changed, or the
//! GPU turned out not to frost.

use smithay::reexports::wayland_server::{Client, Resource};

use crate::{
    protocols::{background_effect, dashi_glass},
    state::Dashi,
};

impl Dashi {
    /// Whether this compositor frosts at all: on screens of its own, on a GPU that can.
    pub(crate) fn glass_frosts(&self) -> bool {
        matches!(self.backend, crate::backend::Backend::Udev(_)) && self.glass.can()
    }

    /// Whether `client`'s panes are drawn (dashi_glass_v1 `drawing`): granted, styled, frosting.
    pub(crate) fn glass_material(&self, client: &Client) -> bool {
        self.glass.style.is_some()
            && self.glass_frosts()
            && self.glass.clients.granted(&client.id())
    }

    /// Whether `client`'s blur region is drawn (ext-background-effect's `blur` capability):
    /// as `glass_material`, and not while glass is solid (the app's own fill shows then).
    pub(crate) fn glass_drawn(&self, client: &Client) -> bool {
        self.glass_material(client)
            && self
                .glass
                .style
                .as_ref()
                .and_then(|s| s.app_look())
                .is_some()
    }

    /// Tell every glass client whether its glass is drawn, where that changed.
    pub(crate) fn announce_glass(&mut self) {
        self.glass
            .managers
            .retain(|manager| manager.upgrade().is_ok());
        self.glass.objects.retain(|(_, object)| object.is_alive());
        let mut said = std::mem::take(&mut self.glass.said);
        said.retain(|id, _| {
            self.glass.objects.iter().any(|(_, o)| &o.id() == id)
                || self.glass.managers.iter().any(|m| &m.id() == id)
        });
        for manager in self.glass.managers.iter().filter_map(|m| m.upgrade().ok()) {
            let Some(client) = manager.client() else {
                continue;
            };
            let drawn = self.glass_drawn(&client);
            if said.insert(manager.id(), drawn) != Some(drawn) {
                manager.capabilities(background_effect::capabilities(drawn));
            }
        }
        for (_, object) in &self.glass.objects {
            let Some(client) = object.client() else {
                continue;
            };
            let drawn = self.glass_material(&client);
            if said.insert(object.id(), drawn) != Some(drawn) {
                object.drawing(dashi_glass::drawing(drawn));
            }
        }
        self.glass.said = said;
    }
}
