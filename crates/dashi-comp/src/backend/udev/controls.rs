//! What the IPC asks of the screens: a mode (Displays), lit or dark
//! (`power`), and a tint (`gamma`).

use smithay::{
    backend::drm::{DrmNode, output::DrmOutputRenderElements},
    output::{Mode as WlMode, Output},
    reexports::drm::control::crtc,
};

use super::{ScreenId, UdevData, UdevRenderer, apply_gamma, render_screen, with_udev};
use crate::{render, state::Dashi};

impl UdevData {
    /// `gamma`: each screen's ramps scaled by the tint (1, 1, 1 is none).
    pub(crate) fn set_gamma(&mut self, tint: Option<[f64; 3]>) {
        self.gamma = tint;
        for device in self.devices.values() {
            for crtc in device.screens.keys() {
                apply_gamma(device.manager.device(), *crtc, tint);
            }
        }
    }

    pub(crate) fn set_mode(&mut self, output: &Output, mode: WlMode) -> Result<(), String> {
        let id = *output
            .user_data()
            .get::<ScreenId>()
            .ok_or("not a screen of this GPU")?;
        let device = self
            .devices
            .get_mut(&id.node)
            .ok_or("not a screen of this GPU")?;
        let render_node = device.render_node.unwrap_or(self.primary_gpu);
        let screen = device
            .screens
            .get_mut(&id.crtc)
            .ok_or("not a screen of this GPU")?;
        let drm_mode = screen
            .modes
            .iter()
            .find(|m| WlMode::from(**m) == mode)
            .copied()
            .ok_or("the screen does not offer that mode")?;
        let mut renderer = self
            .gpus
            .single_renderer(&render_node)
            .map_err(|error| format!("{error:?}"))?;
        screen
            .scanout
            .use_mode::<_, render::DashiElement<UdevRenderer<'_>>>(
                drm_mode,
                &mut renderer,
                &DrmOutputRenderElements::default(),
            )
            .map_err(|error| format!("the mode did not take: {error:?}"))?;
        screen.flip.clear();
        Ok(())
    }

    pub(crate) fn set_enabled(&mut self, output: &Output, enabled: bool) {
        let Some(screen) = self.screen_of(output) else {
            return;
        };
        screen.powered = enabled && !screen.held;
        screen.flip.clear();
        if !screen.powered
            && let Err(error) = screen
                .scanout
                .with_compositor(|compositor| compositor.clear())
        {
            tracing::warn!(%error, "turning a screen off");
        }
    }

    /// `power`: screens dark or lit; the ones changed are returned, to draw
    /// again (a dark one paces its clients, pace.rs). With
    /// `only`, just the screen of that name, which stays as it is left: a
    /// held-dark screen stays dark when the rest are lit. None by that name
    /// is an error.
    pub(crate) fn set_power(
        &mut self,
        on: bool,
        reset: bool,
        only: Option<&str>,
    ) -> Result<Vec<(DrmNode, crtc::Handle)>, String> {
        let mut lit = Vec::new();
        let mut found = false;
        for (node, device) in &mut self.devices {
            if on
                && reset
                && let Err(error) = device.manager.device_mut().reset_state()
            {
                tracing::warn!(%error, "resetting a GPU's state");
            }
            for (crtc, screen) in &mut device.screens {
                if let Some(name) = only {
                    if screen.output.name() != name {
                        continue;
                    }
                    found = true;
                    screen.held = !on;
                } else if on && screen.held {
                    continue;
                }
                if on {
                    screen.powered = true;
                    screen.flip.clear();
                    lit.push((*node, *crtc));
                } else if screen.powered {
                    screen.powered = false;
                    screen.flip.clear();
                    lit.push((*node, *crtc));
                    if let Err(error) = screen
                        .scanout
                        .with_compositor(|compositor| compositor.clear())
                    {
                        tracing::warn!(%error, "turning a screen off");
                    }
                }
            }
        }
        if let Some(name) = only
            && !found
        {
            return Err(format!("no screen named {name}"));
        }
        if on && let Some(tint) = self.gamma {
            self.set_gamma(Some(tint));
        }
        Ok(lit)
    }
}

/// `power {on, reset?, output?}`: the screens (or that one) dark, or lit and drawn again;
/// dark, their clients still hear of frames (pace.rs).
pub(crate) fn power(
    state: &mut Dashi,
    on: bool,
    reset: bool,
    only: Option<&str>,
) -> Result<(), String> {
    let lit =
        with_udev(state, |_, data| data.set_power(on, reset, only)).unwrap_or(Ok(Vec::new()))?;
    for (node, crtc) in lit {
        state
            .loop_handle
            .insert_idle(move |state| render_screen(state, node, crtc));
    }
    Ok(())
}
