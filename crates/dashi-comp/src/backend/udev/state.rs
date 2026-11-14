//! The backend's state: its GPUs, each device and the screens on it, the
//! seat's session, and libinput.

use std::collections::{HashMap, HashSet};
use std::time::Instant;

use smithay::desktop::utils::OutputPresentationFeedback;
use smithay::{
    backend::{
        allocator::{
            Fourcc,
            dmabuf::{Dmabuf, WeakDmabuf},
            gbm::GbmAllocator,
        },
        drm::{
            DrmDeviceFd, DrmNode,
            exporter::gbm::GbmFramebufferExporter,
            output::{DrmOutput, DrmOutputManager},
        },
        renderer::{
            ImportDma,
            gles::GlesRenderer,
            multigpu::{GpuManager, MultiRenderer, gbm::GbmGlesBackend},
        },
        session::{Session, libseat::LibSeatSession},
    },
    output::Output,
    reexports::{
        calloop::RegistrationToken, drm::control::crtc, input::Libinput,
        wayland_server::backend::GlobalId,
    },
    utils::DeviceFd,
};
use smithay_drm_extras::drm_scanner::DrmScanner;

use super::{feedback, flip, input_devices, planes, probe, sleep};
use crate::{backend::Backend, render, state::Dashi};

pub(super) type Gpus = GpuManager<GbmGlesBackend<GlesRenderer, DrmDeviceFd>>;
pub(super) type UdevRenderer<'a> = MultiRenderer<
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
pub(super) type FrameData = Option<OutputPresentationFeedback>;
pub(super) type OutputManager = DrmOutputManager<
    GbmAllocator<DrmDeviceFd>,
    GbmFramebufferExporter<DrmDeviceFd>,
    FrameData,
    DrmDeviceFd,
>;
pub(super) type Scanout = DrmOutput<
    GbmAllocator<DrmDeviceFd>,
    GbmFramebufferExporter<DrmDeviceFd>,
    FrameData,
    DrmDeviceFd,
>;

/// Formats a screen may scan out, best first (10 bit when the hardware has it).
pub(super) const SCANOUT_FORMATS: &[Fourcc] = &[
    Fourcc::Abgr2101010,
    Fourcc::Argb2101010,
    Fourcc::Abgr8888,
    Fourcc::Argb8888,
];

pub(crate) struct UdevData {
    pub(super) session: LibSeatSession,
    pub(super) primary_gpu: DrmNode,
    pub(super) gpus: Gpus,
    pub(super) devices: HashMap<DrmNode, Device>,
    /// Every GPU that does not draw, open or asleep (sleep.rs, lifecycle.rs).
    pub(super) cards: HashMap<DrmNode, sleep::Card>,
    /// Cards the shell keeps open with nothing on them (`gpu-keep`).
    pub(super) kept: HashSet<String>,
    /// When waking the sleeping GPUs last failed to read a client's buffer.
    pub(super) buffer_wake_failed: Option<Instant>,
    /// Where probes' threads answer (probe.rs).
    pub(super) probes: smithay::reexports::calloop::channel::Sender<probe::ProbeAnswer>,
    /// Client buffers waiting for a GPU woken for them (imports.rs).
    pub(super) waiting: Vec<(Dmabuf, smithay::wayland::dmabuf::ImportNotifier)>,
    pub(super) libinput: Libinput,
    pub(super) input_devices: input_devices::InputDevices,
    /// The tint to keep on every screen (`gamma`), as red, green, blue factors.
    pub(super) gamma: Option<[f64; 3]>,
}

pub(super) struct Device {
    pub(super) manager: OutputManager,
    pub(super) scanner: DrmScanner,
    pub(super) render_node: Option<DrmNode>,
    pub(super) screens: HashMap<crtc::Handle, Screen>,
    pub(super) token: RegistrationToken,
    /// udev's name for it (`card0`).
    pub(super) card: String,
    /// The fd the seat opened, handed back to it when the GPU goes to sleep.
    pub(super) fd: DeviceFd,
    /// Client buffers only this GPU could read: it stays open while they live.
    pub(super) buffers: Vec<WeakDmabuf>,
}

pub(super) struct Screen {
    pub(super) output: Output,
    pub(super) scanout: Scanout,
    pub(super) global: GlobalId,
    /// A frame queued and its vblank, watched (flip.rs).
    pub(super) flip: flip::Flip,
    /// The planes its frames may use, fewer after the display refuses one (planes.rs).
    pub(super) planes: planes::Planes,
    /// The timer set to draw it next, when it fires, and which it is (pace.rs).
    pub(super) scheduled: Option<(RegistrationToken, Instant, u64)>,
    /// Nothing new to draw and nothing woke the loop for a while: only the
    /// watchdog's second until something does (wakes.rs, frame.rs).
    pub(super) asleep: bool,
    /// Turns with nothing new since it last drew or was poked.
    pub(super) quiet: crate::wakes::Quiet,
    /// The screen is lit (`power`, and on in Displays).
    pub(super) powered: bool,
    /// Held dark by `power {on: false, output}` (brightness at 0 on a panel
    /// whose backlight never goes out, such as an OLED): lighting every
    /// screen (waking from idle) and Displays leave it dark.
    pub(super) held: bool,
    /// The connector's modes, to switch to one (Displays).
    pub(super) modes: Vec<smithay::reexports::drm::control::Mode>,
    /// Whether it can change its refresh rate as frames come (vrr.rs).
    pub(super) vrr: smithay::backend::drm::VrrSupport,
    /// What its surfaces hear about buffer formats (feedback.rs).
    pub(super) feedback: Option<feedback::ScreenFeedback>,
}

/// Which device and CRTC an output is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ScreenId {
    pub(super) node: DrmNode,
    pub(super) crtc: crtc::Handle,
}

impl UdevData {
    pub(crate) fn set_leds(&mut self, leds: smithay::input::keyboard::LedState) {
        self.input_devices.set_leds(leds);
    }

    pub(crate) fn apply_input(&mut self, settings: &crate::input::settings::InputSettings) {
        self.input_devices.apply_input(settings);
    }

    pub(crate) fn pointers(&self) -> crate::input::Pointers {
        self.input_devices.pointers()
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

    pub(super) fn screen_of(&mut self, output: &Output) -> Option<&mut Screen> {
        let id = *output.user_data().get::<ScreenId>()?;
        self.devices.get_mut(&id.node)?.screens.get_mut(&id.crtc)
    }

    /// Import a client's buffer on the drawing GPU, else any open one; one
    /// only another GPU could read keeps that GPU open while it lives.
    pub(super) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
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

/// With the backend taken out of the state for the call (device callbacks need both).
pub(super) fn with_udev<T>(
    state: &mut Dashi,
    f: impl FnOnce(&mut Dashi, &mut UdevData) -> T,
) -> Option<T> {
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
