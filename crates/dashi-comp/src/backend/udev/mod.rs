//! A seat of its own: DRM/KMS screens on GBM and GLES, input from libinput,
//! and the session from libseat (so VT switching and suspend work). Adapted
//! from smithay's anvil example (MIT, github.com/Smithay/smithay, v0.7.0),
//! without leasing, explicit sync, and presentation feedback (C4).
//!
//! The GPU is `DASHI_DRM_DEVICE` when set (dashi-session picks the one that
//! drives a screen, packages/shell/bin/dashi-gpu.ts), else the seat's primary.

mod devices;
mod edid;
mod feedback;
mod frame;
mod screens;
mod start;

pub(crate) use start::init;

use devices::{advertise_formats, device_added, device_removed, offer_explicit_sync};
use frame::{frame_finished, render_device, render_screen};
use screens::{apply_gamma, connector_disconnected, scan_connectors};
mod keyboards;
mod vrr;

pub(crate) use vrr::VrrReport;

use std::{collections::HashMap, path::Path, time::Duration};

use serde_json::json;
use smithay::desktop::utils::OutputPresentationFeedback;
use smithay::{
    backend::{
        allocator::{
            Fourcc,
            dmabuf::Dmabuf,
            format::FormatSet,
            gbm::{GbmAllocator, GbmBufferFlags, GbmDevice},
        },
        drm::{
            DrmDevice, DrmDeviceFd, DrmEvent, DrmEventMetadata, DrmEventTime, DrmNode, NodeType,
            compositor::FrameFlags,
            exporter::gbm::GbmFramebufferExporter,
            output::{DrmOutput, DrmOutputManager, DrmOutputRenderElements},
        },
        egl::{EGLDevice, EGLDisplay},
        input::InputEvent,
        libinput::{LibinputInputBackend, LibinputSessionInterface},
        renderer::{
            ImportDma, ImportMemWl,
            gles::GlesRenderer,
            multigpu::{GpuManager, MultiRenderer, gbm::GbmGlesBackend},
        },
        session::{Event as SessionEvent, Session, libseat::LibSeatSession},
        udev::{UdevBackend, UdevEvent, all_gpus, primary_gpu},
    },
    output::{Mode as WlMode, Output, PhysicalProperties},
    reexports::{
        calloop::{
            LoopHandle, RegistrationToken,
            timer::{TimeoutAction, Timer},
        },
        drm::control::{Device as ControlDevice, ModeTypeFlags, connector, crtc},
        input::Libinput,
        rustix::fs::OFlags,
        wayland_protocols::wp::presentation_time::server::wp_presentation_feedback,
        wayland_server::backend::GlobalId,
    },
    utils::{Clock, DeviceFd, Monotonic},
    wayland::{dmabuf::DmabufFeedbackBuilder, presentation::Refresh},
};
use smithay_drm_extras::drm_scanner::{DrmScanEvent, DrmScanner};

use super::{BACKGROUND, Backend};
use crate::{render, state::Dashi};

type Gpus = GpuManager<GbmGlesBackend<GlesRenderer, DrmDeviceFd>>;
type UdevRenderer<'a> = MultiRenderer<
    'a,
    'a,
    GbmGlesBackend<GlesRenderer, DrmDeviceFd>,
    GbmGlesBackend<GlesRenderer, DrmDeviceFd>,
>;
impl<'a> render::rounded::GlesAccess for UdevRenderer<'a> {
    fn gles(&mut self) -> &mut GlesRenderer {
        self.as_mut()
    }

    fn gles_frame<'f, 'frame, 'buffer>(
        frame: &'f mut <Self as smithay::backend::renderer::RendererSuper>::Frame<'frame, 'buffer>,
    ) -> &'f mut smithay::backend::renderer::gles::GlesFrame<'frame, 'buffer> {
        frame.as_mut()
    }
}

/// What a queued frame carries to its vblank: the clients to tell it was shown.
type FrameData = Option<OutputPresentationFeedback>;
type OutputManager = DrmOutputManager<
    GbmAllocator<DrmDeviceFd>,
    GbmFramebufferExporter<DrmDeviceFd>,
    FrameData,
    DrmDeviceFd,
>;
type Scanout = DrmOutput<
    GbmAllocator<DrmDeviceFd>,
    GbmFramebufferExporter<DrmDeviceFd>,
    FrameData,
    DrmDeviceFd,
>;

/// Formats a screen may scan out, best first (10 bit when the hardware has it).
const SCANOUT_FORMATS: &[Fourcc] = &[
    Fourcc::Abgr2101010,
    Fourcc::Argb2101010,
    Fourcc::Abgr8888,
    Fourcc::Argb8888,
];

pub(crate) struct UdevData {
    session: LibSeatSession,
    primary_gpu: DrmNode,
    gpus: Gpus,
    devices: HashMap<DrmNode, Device>,
    libinput: Libinput,
    keyboards: keyboards::Keyboards,
    /// The tint to keep on every screen (`gamma`), as red, green, blue factors.
    gamma: Option<[f64; 3]>,
}

struct Device {
    manager: OutputManager,
    scanner: DrmScanner,
    render_node: Option<DrmNode>,
    screens: HashMap<crtc::Handle, Screen>,
    token: RegistrationToken,
}

struct Screen {
    output: Output,
    scanout: Scanout,
    global: GlobalId,
    /// A frame is queued and its vblank has not come yet.
    queued: bool,
    /// A render is already scheduled.
    scheduled: bool,
    /// The screen is lit (`power`, and on in Displays).
    powered: bool,
    /// The connector's modes, to switch to one (Displays).
    modes: Vec<smithay::reexports::drm::control::Mode>,
    /// Whether it can change its refresh rate as frames come (vrr.rs).
    vrr: smithay::backend::drm::VrrSupport,
    /// What its surfaces hear about buffer formats (feedback.rs).
    feedback: Option<feedback::ScreenFeedback>,
}

/// Which device and CRTC an output is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScreenId {
    node: DrmNode,
    crtc: crtc::Handle,
}

impl UdevData {
    pub(crate) fn set_leds(&mut self, leds: smithay::input::keyboard::LedState) {
        self.keyboards.set_leds(leds);
    }

    pub(crate) fn change_vt(&mut self, vt: u32) {
        if let Err(error) = self.session.change_vt(vt as i32) {
            tracing::warn!(vt, %error, "switching VT");
        }
    }

    /// Run `f` with the drawing GPU's renderer.
    pub(crate) fn with_renderer<T>(
        &mut self,
        f: impl FnOnce(&mut UdevRenderer<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut renderer = self
            .gpus
            .single_renderer(&self.primary_gpu)
            .map_err(|error| format!("{error:?}"))?;
        f(&mut renderer)
    }

    /// `gamma`: each screen's ramps scaled by the tint (1, 1, 1 is none).
    pub(crate) fn set_gamma(&mut self, tint: Option<[f64; 3]>) {
        self.gamma = tint;
        for device in self.devices.values() {
            for crtc in device.screens.keys() {
                apply_gamma(device.manager.device(), *crtc, tint);
            }
        }
    }

    fn screen_of(&mut self, output: &Output) -> Option<&mut Screen> {
        let id = *output.user_data().get::<ScreenId>()?;
        self.devices.get_mut(&id.node)?.screens.get_mut(&id.crtc)
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
        screen.queued = false;
        Ok(())
    }

    pub(crate) fn set_enabled(&mut self, output: &Output, enabled: bool) {
        let Some(screen) = self.screen_of(output) else {
            return;
        };
        screen.powered = enabled;
        screen.queued = false;
        if !enabled
            && let Err(error) = screen
                .scanout
                .with_compositor(|compositor| compositor.clear())
        {
            tracing::warn!(%error, "turning a screen off");
        }
    }

    /// `power`: screens dark or lit. Lighting them draws them again.
    pub(crate) fn set_power(&mut self, on: bool, reset: bool) -> Vec<(DrmNode, crtc::Handle)> {
        let mut lit = Vec::new();
        for (node, device) in &mut self.devices {
            if on
                && reset
                && let Err(error) = device.manager.device_mut().reset_state()
            {
                tracing::warn!(%error, "resetting a GPU's state");
            }
            for (crtc, screen) in &mut device.screens {
                if on {
                    screen.powered = true;
                    screen.queued = false;
                    lit.push((*node, *crtc));
                } else if screen.powered {
                    screen.powered = false;
                    if let Err(error) = screen
                        .scanout
                        .with_compositor(|compositor| compositor.clear())
                    {
                        tracing::warn!(%error, "turning a screen off");
                    }
                }
            }
        }
        if on && let Some(tint) = self.gamma {
            self.set_gamma(Some(tint));
        }
        lit
    }

    pub(crate) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        self.gpus
            .single_renderer(&self.primary_gpu)
            .is_ok_and(|mut renderer| renderer.import_dmabuf(dmabuf, None).is_ok())
    }
}

/// `power {on, reset?}`: the screens dark, or lit and drawn again.
pub(crate) fn power(state: &mut Dashi, on: bool, reset: bool) {
    let lit = with_udev(state, |_, data| data.set_power(on, reset)).unwrap_or_default();
    for (node, crtc) in lit {
        state
            .loop_handle
            .insert_idle(move |state| render_screen(state, node, crtc));
    }
}

/// With the backend taken out of the state for the call (device callbacks need both).
fn with_udev<T>(state: &mut Dashi, f: impl FnOnce(&mut Dashi, &mut UdevData) -> T) -> Option<T> {
    match std::mem::take(&mut state.backend) {
        Backend::Udev(mut data) => {
            let result = f(state, &mut data);
            state.backend = Backend::Udev(data);
            Some(result)
        }
        other => {
            state.backend = other;
            None
        }
    }
}

/// The serial an EDID gave a screen (outputs/report.rs reports it).
pub(crate) struct Serial(pub String);
