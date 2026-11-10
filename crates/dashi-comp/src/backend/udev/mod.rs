//! A seat of its own: DRM/KMS screens on GBM and GLES, input from libinput,
//! and the session from libseat (so VT switching and suspend work). Adapted
//! from smithay's anvil example (MIT, github.com/Smithay/smithay, v0.7.0),
//! without leasing, explicit sync, and presentation feedback (C4).
//!
//! The GPU is `DASHI_DRM_DEVICE` when set (dashi-session picks the one that
//! drives a screen, packages/shell/bin/dashi-gpu.ts), else the seat's primary.
//! Every other GPU is open only while something needs it (sleep.rs), and
//! probed off the event loop before each opening (probe.rs).

mod devices;
mod edid;
mod feedback;
mod flip;
mod frame;
mod gone;
mod holds;
mod imports;
mod lifecycle;
mod pace;
mod probe;
mod screens;
mod sleep;
mod start;

pub(crate) use frame::wake_screens;
pub(crate) use holds::describe_gpus;
pub(crate) use imports::import_dmabuf;
pub(crate) use pace::agent_acted;
pub(crate) use sleep::keep_gpu;
pub(crate) use start::init;

use devices::{
    advertise_formats, device_added, device_removed, is_drawing_gpu, offer_explicit_sync,
};
use frame::{frame_finished, render_device, render_screen};
use screens::{apply_gamma, connector_disconnected, scan_connectors};
mod input_devices;
mod vrr;
mod watchdog;

pub(crate) use vrr::VrrReport;

use std::{
    collections::{HashMap, HashSet},
    os::fd::OwnedFd,
    path::Path,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use smithay::desktop::utils::OutputPresentationFeedback;
use smithay::{
    backend::{
        allocator::{
            Fourcc,
            dmabuf::{Dmabuf, WeakDmabuf},
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

    fn gles_error(
        error: smithay::backend::renderer::gles::GlesError,
    ) -> <Self as smithay::backend::renderer::RendererSuper>::Error {
        smithay::backend::renderer::multigpu::Error::Render(error)
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
    /// Every GPU that does not draw, open or asleep (sleep.rs, lifecycle.rs).
    cards: HashMap<DrmNode, sleep::Card>,
    /// Cards the shell keeps open with nothing on them (`gpu-keep`).
    kept: HashSet<String>,
    /// When waking the sleeping GPUs last failed to read a client's buffer.
    buffer_wake_failed: Option<Instant>,
    /// Where probes' threads answer (probe.rs).
    probes: smithay::reexports::calloop::channel::Sender<probe::ProbeAnswer>,
    /// Client buffers waiting for a GPU woken for them (imports.rs).
    waiting: Vec<(Dmabuf, smithay::wayland::dmabuf::ImportNotifier)>,
    libinput: Libinput,
    input_devices: input_devices::InputDevices,
    /// The tint to keep on every screen (`gamma`), as red, green, blue factors.
    gamma: Option<[f64; 3]>,
}

struct Device {
    manager: OutputManager,
    scanner: DrmScanner,
    render_node: Option<DrmNode>,
    screens: HashMap<crtc::Handle, Screen>,
    token: RegistrationToken,
    /// udev's name for it (`card0`).
    card: String,
    /// The fd the seat opened, handed back to it when the GPU goes to sleep.
    fd: DeviceFd,
    /// Client buffers only this GPU could read: it stays open while they live.
    buffers: Vec<WeakDmabuf>,
}

struct Screen {
    output: Output,
    scanout: Scanout,
    global: GlobalId,
    /// A frame queued and its vblank, watched (flip.rs).
    flip: flip::Flip,
    /// The timer set to draw it next, when it fires, and which it is (pace.rs).
    scheduled: Option<(RegistrationToken, Instant, u64)>,
    /// Nothing new to draw and nothing woke the loop for a while: only the
    /// watchdog's second until something does (wakes.rs, frame.rs).
    asleep: bool,
    /// Turns with nothing new since it last drew or was poked.
    quiet: crate::wakes::Quiet,
    /// The screen is lit (`power`, and on in Displays).
    powered: bool,
    /// Held dark by `power {on: false, output}` (brightness at 0 on a panel
    /// whose backlight never goes out, such as an OLED): lighting every
    /// screen (waking from idle) and Displays leave it dark.
    held: bool,
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
        self.input_devices.set_leds(leds);
    }

    pub(crate) fn apply_input(&mut self, settings: &crate::input::settings::InputSettings) {
        self.input_devices.apply_input(settings);
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

    /// Import a client's buffer on the drawing GPU, else any open one; one
    /// only another GPU could read keeps that GPU open while it lives.
    fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        let imported = self
            .gpus
            .single_renderer(&self.primary_gpu)
            .is_ok_and(|mut renderer| renderer.import_dmabuf(dmabuf, None).is_ok());
        if imported
            && let Some(node) = dmabuf.node()
            && node != self.primary_gpu
            && let Some(device) = self
                .devices
                .values_mut()
                .find(|device| device.render_node == Some(node))
        {
            device.buffers.push(dmabuf.weak());
        }
        imported
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
