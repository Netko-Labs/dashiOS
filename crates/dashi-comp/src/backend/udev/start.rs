//! Taking the seat: the session (libseat), the drawing GPU, libinput, every
//! GPU there is (the ones nothing needs left asleep, sleep.rs), and udev to
//! hear about the ones plugged in later.

use super::*;

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
            if matches!(
                event,
                InputEvent::DeviceAdded { .. } | InputEvent::DeviceRemoved { .. }
            ) {
                // A touchpad or a mouse came or went: the shell hears which kinds are here now.
                if let Some(Some(pointers)) =
                    with_udev(state, |_, data| data.input_devices.device_event(&event))
                {
                    state
                        .ipc
                        .emit(crate::ipc::protocol::Event::Pointers { pointers });
                }
            } else {
                state.process_input_event(event);
            }
        },
    )?;

    let gpus = GpuManager::new(renderer::backend())?;
    let probes = probe::probes(handle)?;
    state.backend = Backend::Udev(Box::new(UdevData {
        session,
        primary_gpu,
        gpus,
        devices: HashMap::new(),
        cards: HashMap::new(),
        kept: HashSet::new(),
        buffer_wake_failed: None,
        probes,
        waiting: Vec::new(),
        libinput,
        input_devices: Default::default(),
        gamma: None,
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
                    device.screens.values_mut().for_each(|screen| {
                        screen.flip.clear();
                        screen.planes.clear();
                    });
                }
                data.devices.keys().copied().collect::<Vec<_>>()
            })
            .unwrap_or_default();
            for node in nodes {
                state
                    .loop_handle
                    .insert_idle(move |state| render_device(state, node));
            }
            sleep::session_active(state);
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
                if let Err(error) = sleep::gpu_found(state, node, &path) {
                    tracing::warn!(%error, ?path, "skipping a GPU");
                }
            }
            Err(error) => tracing::warn!(%error, "a GPU without a DRM node"),
        }
    }
    advertise_formats(state)?;
    offer_explicit_sync(state);

    handle.insert_source(udev, |event, _, state| match event {
        UdevEvent::Added { device_id, path } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id)
                && let Err(error) = sleep::gpu_found(state, node, &path)
            {
                tracing::warn!(%error, ?path, "skipping a GPU");
            }
        }
        UdevEvent::Changed { device_id } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id) {
                sleep::gpu_changed(state, node);
            }
        }
        UdevEvent::Removed { device_id } => {
            if let Ok(node) = DrmNode::from_dev_id(device_id) {
                sleep::gpu_gone(state, node);
            }
        }
    })?;
    Ok(())
}
