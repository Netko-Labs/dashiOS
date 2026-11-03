//! Screens coming and going: the connectors scanned on a device, an output
//! for each connected one (at its preferred mode, to the right of the
//! others), its gamma and identity (EDID).

use super::*;

pub(super) fn scan_connectors(state: &mut Dashi, node: DrmNode) {
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
        apply_gamma(device.manager.device(), crtc, data.gamma);
        let vrr = scanout
            .with_compositor(|compositor| compositor.vrr_supported(connector.handle()))
            .unwrap_or(smithay::backend::drm::VrrSupport::NotSupported);
        let feedback = scanout.with_compositor(|compositor| {
            feedback::for_screen(&mut data.gpus, primary_gpu, node, compositor.surface())
        });
        device.screens.insert(
            crtc,
            Screen {
                output: output.clone(),
                scanout,
                global,
                queued: false,
                scheduled: false,
                powered: true,
                held: false,
                modes: connector.modes().to_vec(),
                vrr,
                feedback,
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

pub(super) fn connector_disconnected(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) -> bool {
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

/// Write a CRTC's gamma ramps: linear, scaled per channel.
pub(super) fn apply_gamma(device: &DrmDevice, crtc: crtc::Handle, tint: Option<[f64; 3]>) {
    let Ok(info) = device.get_crtc(crtc) else {
        return;
    };
    let length = info.gamma_length() as usize;
    if length < 2 {
        return;
    }
    let [r, g, b] = tint.unwrap_or([1.0, 1.0, 1.0]);
    let ramp = |factor: f64| -> Vec<u16> {
        (0..length)
            .map(|i| {
                ((i as f64 / (length - 1) as f64) * 65535.0 * factor.clamp(0.0, 1.0)).round() as u16
            })
            .collect()
    };
    if let Err(error) = device.set_gamma(crtc, &ramp(r), &ramp(g), &ramp(b)) {
        tracing::warn!(%error, "setting a screen's gamma");
    }
}

fn edid_of(device: &DrmDevice, connector: connector::Handle) -> Option<edid::Identity> {
    let properties = device.get_properties(connector).ok()?;
    let (handles, values) = properties.as_props_and_values();
    let blob = handles.iter().zip(values).find_map(|(handle, value)| {
        let info = device.get_property(*handle).ok()?;
        (info.name().to_str() == Ok("EDID")).then_some(*value)
    })?;
    edid::parse(&device.get_property_blob(blob).ok()?)
}
