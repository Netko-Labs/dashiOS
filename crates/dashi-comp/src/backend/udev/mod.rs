//! A seat of its own: DRM/KMS screens on GBM and GLES, input from libinput,
//! and the session from libseat (so VT switching and suspend work). Adapted
//! from smithay's anvil example (MIT, github.com/Smithay/smithay, v0.7.0),
//! without leasing, explicit sync, and presentation feedback (C4).
//!
//! The GPU is `DASHI_DRM_DEVICE` when set (dashi-session picks the one that
//! drives a screen, packages/shell/bin/dashi-gpu.ts), else the seat's primary.

mod edid;

use std::{collections::HashMap, path::Path, time::Duration};

use serde_json::json;
use smithay::{
    backend::{
        allocator::{
            Fourcc,
            dmabuf::Dmabuf,
            format::FormatSet,
            gbm::{GbmAllocator, GbmBufferFlags, GbmDevice},
        },
        drm::{
            DrmDevice, DrmDeviceFd, DrmEvent, DrmNode, NodeType,
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
        wayland_server::backend::GlobalId,
    },
    utils::DeviceFd,
    wayland::dmabuf::DmabufFeedbackBuilder,
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
type OutputManager = DrmOutputManager<
    GbmAllocator<DrmDeviceFd>,
    GbmFramebufferExporter<DrmDeviceFd>,
    (),
    DrmDeviceFd,
>;
type Scanout =
    DrmOutput<GbmAllocator<DrmDeviceFd>, GbmFramebufferExporter<DrmDeviceFd>, (), DrmDeviceFd>;

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
}

/// Which device and CRTC an output is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ScreenId {
    node: DrmNode,
    crtc: crtc::Handle,
}

impl UdevData {
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

    pub(crate) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        self.gpus
            .single_renderer(&self.primary_gpu)
            .is_ok_and(|mut renderer| renderer.import_dmabuf(dmabuf, None).is_ok())
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

pub(crate) fn init(
    handle: &LoopHandle<'static, Dashi>,
    state: &mut Dashi,
) -> Result<(), Box<dyn std::error::Error>> {
    let (session, notifier) =
        LibSeatSession::new().map_err(|error| format!("no seat session (libseat): {error}"))?;
    let seat_name = session.seat();

    let primary_gpu = match std::env::var("DASHI_DRM_DEVICE") {
        // The card dashi-session names; the GPU manager knows GPUs by their render nodes.
        Ok(path) => {
            let node = DrmNode::from_path(&path)
                .map_err(|error| format!("DASHI_DRM_DEVICE={path}: {error}"))?;
            node.node_with_type(NodeType::Render)
                .and_then(Result::ok)
                .unwrap_or(node)
        }
        Err(_) => primary_gpu(&seat_name)?
            .and_then(|path| {
                DrmNode::from_path(path)
                    .ok()?
                    .node_with_type(NodeType::Render)?
                    .ok()
            })
            .or_else(|| {
                all_gpus(&seat_name)
                    .ok()?
                    .into_iter()
                    .find_map(|path| DrmNode::from_path(path).ok())
            })
            .ok_or("no GPU on this seat")?,
    };
    tracing::info!(%primary_gpu, "the GPU that draws");

    let mut libinput =
        Libinput::new_with_udev::<LibinputSessionInterface<LibSeatSession>>(session.clone().into());
    libinput
        .udev_assign_seat(&seat_name)
        .map_err(|()| format!("libinput could not take seat {seat_name}"))?;
    handle.insert_source(
        LibinputInputBackend::new(libinput.clone()),
        |event, _, state| {
            if !matches!(
                event,
                InputEvent::DeviceAdded { .. } | InputEvent::DeviceRemoved { .. }
            ) {
                state.process_input_event(event);
            }
        },
    )?;

    let gpus = GpuManager::new(GbmGlesBackend::default())?;
    state.backend = Backend::Udev(Box::new(UdevData {
        session,
        primary_gpu,
        gpus,
        devices: HashMap::new(),
        libinput,
    }));

    handle.insert_source(notifier, |event, _, state| match event {
        SessionEvent::PauseSession => {
            tracing::info!("session paused (another VT)");
            with_udev(state, |_, data| {
                data.libinput.suspend();
                data.devices
                    .values_mut()
                    .for_each(|device| device.manager.pause());
            });
        }
        SessionEvent::ActivateSession => {
            tracing::info!("session active again");
            let nodes = with_udev(state, |_, data| {
                if data.libinput.resume().is_err() {
                    tracing::warn!("libinput did not resume");
                }
                for device in data.devices.values_mut() {
                    if let Err(error) = device.manager.activate(false) {
                        tracing::warn!(%error, "a GPU did not come back");
                    }
                    device
                        .screens
                        .values_mut()
                        .for_each(|screen| screen.queued = false);
                }
                data.devices.keys().copied().collect::<Vec<_>>()
            })
            .unwrap_or_default();
            for node in nodes {
                state
                    .loop_handle
                    .insert_idle(move |state| render_device(state, node));
            }
        }
    })?;

    let udev = UdevBackend::new(&seat_name)?;
    // The drawing GPU first, so screens on other GPUs can be drawn by it.
    let mut devices: Vec<_> = udev
        .device_list()
        .map(|(id, path)| (id, path.to_owned()))
        .collect();
    devices.sort_by_key(|(id, _)| {
        primary_gpu
            .node_with_type(NodeType::Primary)
            .and_then(Result::ok)
            .map(|n| n.dev_id())
            != Some(*id)
    });
    for (id, path) in devices {
        match DrmNode::from_dev_id(id) {
            Ok(node) => {
                if let Err(error) = device_added(state, node, &path) {
                    tracing::warn!(%error, ?path, "skipping a GPU");
                }
            }
            Err(error) => tracing::warn!(%error, "a GPU without a DRM node"),
        }
    }
    advertise_formats(state)?;

    handle.insert_source(udev, |event, _, state| match event {
        UdevEvent::Added { device_id, path } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id)
                && let Err(error) = device_added(state, node, &path)
            {
                tracing::warn!(%error, ?path, "skipping a GPU");
            }
        }
        UdevEvent::Changed { device_id } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id) {
                scan_connectors(state, node);
            }
        }
        UdevEvent::Removed { device_id } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id) {
                device_removed(state, node);
            }
        }
    })?;
    Ok(())
}

/// shm and dmabuf formats from the drawing GPU.
fn advertise_formats(state: &mut Dashi) -> Result<(), Box<dyn std::error::Error>> {
    let formats = with_udev(
        state,
        |state, data| -> Result<_, Box<dyn std::error::Error>> {
            let renderer = data.gpus.single_renderer(&data.primary_gpu)?;
            state.shm_state.update_formats(renderer.shm_formats());
            Ok(renderer.dmabuf_formats())
        },
    )
    .ok_or("the udev backend is gone")??;
    let primary = with_udev(state, |_, data| data.primary_gpu).ok_or("the udev backend is gone")?;
    let feedback = DmabufFeedbackBuilder::new(primary.dev_id(), formats).build()?;
    let dh = state.display_handle.clone();
    state.dmabuf_global = Some(
        state
            .dmabuf_state
            .create_global_with_default_feedback::<Dashi>(&dh, &feedback),
    );
    Ok(())
}

fn device_added(
    state: &mut Dashi,
    node: DrmNode,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let handle = state.loop_handle.clone();
    with_udev(state, |_, data| -> Result<(), Box<dyn std::error::Error>> {
        let fd = data.session.open(
            path,
            OFlags::RDWR | OFlags::CLOEXEC | OFlags::NOCTTY | OFlags::NONBLOCK,
        )?;
        let fd = DrmDeviceFd::new(DeviceFd::from(fd));
        let (drm, notifier) = DrmDevice::new(fd.clone(), true)?;
        let gbm = GbmDevice::new(fd)?;

        let token = handle.insert_source(notifier, move |event, _, state| match event {
            DrmEvent::VBlank(crtc) => frame_finished(state, node, crtc),
            DrmEvent::Error(error) => tracing::warn!(?error, "DRM"),
        })?;

        // SAFETY: the GBM device outlives the display, which the GPU manager keeps with it.
        let render_node = unsafe { EGLDisplay::new(gbm.clone()) }
            .ok()
            .and_then(|display| EGLDevice::device_for_display(&display).ok())
            .filter(|device| !device.is_software())
            .map(|device| device.try_get_render_node().ok().flatten().unwrap_or(node))
            .and_then(|render_node| {
                data.gpus
                    .as_mut()
                    .add_node(render_node, gbm.clone())
                    .ok()
                    .map(|()| render_node)
            });

        let allocator = match render_node {
            Some(_) => GbmAllocator::new(
                gbm.clone(),
                GbmBufferFlags::RENDERING | GbmBufferFlags::SCANOUT,
            ),
            None => data
                .devices
                .values()
                .find(|device| device.render_node == Some(data.primary_gpu))
                .map(|device| device.manager.allocator().clone())
                .ok_or("a display-only GPU, and no drawing GPU to draw for it")?,
        };
        let exporter = GbmFramebufferExporter::new(gbm.clone(), render_node);
        let mut renderer = data
            .gpus
            .single_renderer(&render_node.unwrap_or(data.primary_gpu))?;
        let render_formats: FormatSet = renderer
            .as_mut()
            .egl_context()
            .dmabuf_render_formats()
            .iter()
            .filter(|format| {
                render_node.is_some()
                    || format.modifier == smithay::backend::allocator::Modifier::Linear
            })
            .copied()
            .collect();
        let manager = DrmOutputManager::new(
            drm,
            allocator,
            exporter,
            Some(gbm),
            SCANOUT_FORMATS.iter().copied(),
            render_formats,
        );
        data.devices.insert(
            node,
            Device {
                manager,
                scanner: DrmScanner::new(),
                render_node,
                screens: HashMap::new(),
                token,
            },
        );
        Ok(())
    })
    .ok_or("the udev backend is gone")??;
    scan_connectors(state, node);
    Ok(())
}

fn scan_connectors(state: &mut Dashi, node: DrmNode) {
    let events = with_udev(state, |_, data| {
        let device = data.devices.get_mut(&node)?;
        match device.scanner.scan_connectors(device.manager.device()) {
            Ok(result) => Some(result.into_iter().collect::<Vec<_>>()),
            Err(error) => {
                tracing::warn!(%error, "scanning connectors");
                None
            }
        }
    })
    .flatten()
    .unwrap_or_default();
    let mut changed = false;
    for event in events {
        match event {
            DrmScanEvent::Connected {
                connector,
                crtc: Some(crtc),
            } => {
                changed |= connector_connected(state, node, connector, crtc);
            }
            DrmScanEvent::Disconnected {
                crtc: Some(crtc), ..
            } => {
                changed |= connector_disconnected(state, node, crtc);
            }
            _ => {}
        }
    }
    if changed {
        state.ipc.emit("outputs-changed", json!({}));
    }
}

/// A screen was plugged in: an output at its preferred mode, to the right of the others.
fn connector_connected(
    state: &mut Dashi,
    node: DrmNode,
    connector: connector::Info,
    crtc: crtc::Handle,
) -> bool {
    let name = format!(
        "{}-{}",
        connector.interface().as_str(),
        connector.interface_id()
    );
    let Some(drm_mode) = connector
        .modes()
        .iter()
        .find(|mode| mode.mode_type().contains(ModeTypeFlags::PREFERRED))
        .or_else(|| connector.modes().first())
        .copied()
    else {
        tracing::warn!(name, "a screen without modes");
        return false;
    };
    let x = state
        .space
        .outputs()
        .filter_map(|output| state.space.output_geometry(output))
        .map(|g| g.loc.x + g.size.w)
        .max()
        .unwrap_or(0);
    let dh = state.display_handle.clone();
    let space_output = with_udev(state, |_, data| -> Option<Output> {
        let primary_gpu = data.primary_gpu;
        let device = data.devices.get_mut(&node)?;
        let identity = edid_of(device.manager.device(), connector.handle()).unwrap_or_default();
        let (width_mm, height_mm) = connector.size().unwrap_or((0, 0));
        let output = Output::new(
            name.clone(),
            PhysicalProperties {
                size: (width_mm as i32, height_mm as i32).into(),
                subpixel: connector.subpixel().into(),
                make: identity.make,
                model: identity.model,
            },
        );
        output
            .user_data()
            .insert_if_missing(|| ScreenId { node, crtc });
        output
            .user_data()
            .insert_if_missing(|| Serial(identity.serial));
        for mode in connector.modes() {
            output.add_mode(WlMode::from(*mode));
        }
        let mode = WlMode::from(drm_mode);
        output.set_preferred(mode);
        output.change_current_state(Some(mode), None, None, Some((x, 0).into()));
        let global = output.create_global::<Dashi>(&dh);

        let mut renderer = data
            .gpus
            .single_renderer(&device.render_node.unwrap_or(primary_gpu))
            .ok()?;
        let planes = device.manager.device().planes(&crtc).ok();
        let scanout = device
            .manager
            .initialize_output::<_, render::DashiElement<UdevRenderer<'_>>>(
                crtc,
                drm_mode,
                &[connector.handle()],
                &output,
                planes,
                &mut renderer,
                &DrmOutputRenderElements::default(),
            )
            .inspect_err(|error| tracing::warn!(name, %error, "the screen could not be set up"))
            .ok()?;
        device.screens.insert(
            crtc,
            Screen {
                output: output.clone(),
                scanout,
                global,
                queued: false,
                scheduled: false,
            },
        );
        Some(output)
    })
    .flatten();
    let Some(output) = space_output else {
        return false;
    };
    tracing::info!(name = output.name(), "screen added");
    state.space.map_output(&output, (x, 0));
    smithay::desktop::layer_map_for_output(&output).arrange();
    state
        .loop_handle
        .insert_idle(move |state| render_screen(state, node, crtc));
    true
}

fn connector_disconnected(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) -> bool {
    let dh = state.display_handle.clone();
    let removed = with_udev(state, |_, data| {
        data.devices
            .get_mut(&node)
            .and_then(|device| device.screens.remove(&crtc))
    })
    .flatten();
    let Some(screen) = removed else { return false };
    tracing::info!(name = screen.output.name(), "screen removed");
    state.space.unmap_output(&screen.output);
    dh.remove_global::<Dashi>(screen.global);
    true
}

fn device_removed(state: &mut Dashi, node: DrmNode) {
    let crtcs = with_udev(state, |_, data| {
        data.devices
            .get(&node)
            .map(|d| d.screens.keys().copied().collect::<Vec<_>>())
    })
    .flatten()
    .unwrap_or_default();
    for crtc in crtcs {
        connector_disconnected(state, node, crtc);
    }
    let token = with_udev(state, |_, data| {
        let device = data.devices.remove(&node)?;
        if let Some(render_node) = device.render_node {
            data.gpus.as_mut().remove_node(&render_node);
        }
        Some(device.token)
    })
    .flatten();
    if let Some(token) = token {
        state.loop_handle.remove(token);
    }
    state.ipc.emit("outputs-changed", json!({}));
}

/// The serial an EDID gave a screen (outputs/report.rs reports it).
pub(crate) struct Serial(pub String);

fn edid_of(device: &DrmDevice, connector: connector::Handle) -> Option<edid::Identity> {
    let properties = device.get_properties(connector).ok()?;
    let (handles, values) = properties.as_props_and_values();
    let blob = handles.iter().zip(values).find_map(|(handle, value)| {
        let info = device.get_property(*handle).ok()?;
        (info.name().to_str() == Ok("EDID")).then_some(*value)
    })?;
    edid::parse(&device.get_property_blob(blob).ok()?)
}

fn render_device(state: &mut Dashi, node: DrmNode) {
    let crtcs = with_udev(state, |_, data| {
        data.devices
            .get(&node)
            .map(|d| d.screens.keys().copied().collect::<Vec<_>>())
    })
    .flatten()
    .unwrap_or_default();
    for crtc in crtcs {
        render_screen(state, node, crtc);
    }
}

/// Draw a screen if anything on it changed; else look again in about a frame.
fn render_screen(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    let outcome = with_udev(state, |state, data| -> Option<(Output, bool)> {
        let primary_gpu = data.primary_gpu;
        let device = data.devices.get_mut(&node)?;
        let render_node = device.render_node.unwrap_or(primary_gpu);
        let screen = device.screens.get_mut(&crtc)?;
        screen.scheduled = false;
        if screen.queued {
            return None;
        }
        let output = screen.output.clone();
        let renderer = if render_node == primary_gpu {
            data.gpus.single_renderer(&render_node)
        } else {
            data.gpus
                .renderer(&primary_gpu, &render_node, screen.scanout.format())
        };
        let mut renderer = renderer
            .inspect_err(|error| tracing::warn!(?error, "no renderer for a screen"))
            .ok()?;
        let elements = render::output_elements(state, &mut renderer, &output, true);
        let drawn = match screen.scanout.render_frame(
            &mut renderer,
            &elements,
            BACKGROUND,
            FrameFlags::DEFAULT,
        ) {
            Ok(result) if !result.is_empty => match screen.scanout.queue_frame(()) {
                Ok(()) => {
                    screen.queued = true;
                    true
                }
                Err(error) => {
                    tracing::warn!(?error, "queueing a frame");
                    false
                }
            },
            Ok(_) => false,
            Err(error) => {
                tracing::warn!(?error, "drawing a frame");
                false
            }
        };
        Some((output, drawn))
    })
    .flatten();
    let Some((output, drawn)) = outcome else {
        return;
    };
    state.send_frames(&output);
    if !drawn {
        schedule(state, node, crtc, frame_time(&output));
    }
}

/// A vblank: the queued frame is on screen. Draw the next a little before the following one.
fn frame_finished(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    let output = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        screen.queued = false;
        if let Err(error) = screen.scanout.frame_submitted() {
            tracing::debug!(?error, "frame submitted");
        }
        Some(screen.output.clone())
    })
    .flatten();
    let Some(output) = output else { return };
    // Leave the clients most of the frame to draw, then compose.
    schedule(state, node, crtc, frame_time(&output).mul_f64(0.6));
}

fn schedule(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle, after: Duration) {
    let already = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        Some(std::mem::replace(&mut screen.scheduled, true))
    })
    .flatten();
    if already != Some(false) {
        return;
    }
    let _ = state
        .loop_handle
        .insert_source(Timer::from_duration(after), move |_, _, state| {
            render_screen(state, node, crtc);
            TimeoutAction::Drop
        });
}

fn frame_time(output: &Output) -> Duration {
    let refresh = output
        .current_mode()
        .map(|mode| mode.refresh)
        .filter(|r| *r > 0)
        .unwrap_or(60_000);
    Duration::from_secs_f64(1_000.0 / f64::from(refresh))
}
