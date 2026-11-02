//! GPUs coming and going: a DRM device opened through the session, its
//! output manager and render node, the formats offered to clients from the
//! drawing GPU, and explicit sync when it can wait on syncobjs.

use super::*;

/// linux-drm-syncobj, on the drawing GPU's device, if it can wait on syncobjs.
pub(super) fn offer_explicit_sync(state: &mut Dashi) {
    let device = with_udev(state, |_, data| {
        let primary = data.primary_gpu;
        data.devices
            .iter()
            .find(|(node, device)| {
                device.render_node == Some(primary)
                    || node.node_with_type(NodeType::Render).and_then(Result::ok) == Some(primary)
            })
            .map(|(_, device)| device.manager.device().device_fd().clone())
    })
    .flatten();
    if let Some(device) = device {
        let dh = state.display_handle.clone();
        crate::handlers::sync::offer_explicit_sync(state, &dh, device);
    }
}

/// shm and dmabuf formats from the drawing GPU.
pub(super) fn advertise_formats(state: &mut Dashi) -> Result<(), Box<dyn std::error::Error>> {
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

pub(super) fn device_added(
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

        let token = handle.insert_source(notifier, move |event, metadata, state| match event {
            DrmEvent::VBlank(crtc) => frame_finished(state, node, crtc, metadata.take()),
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

pub(super) fn device_removed(state: &mut Dashi, node: DrmNode) {
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
