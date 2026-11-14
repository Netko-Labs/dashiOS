//! The input devices libinput finds: the keyboards' lights (Caps Lock, Num
//! Lock, Scroll Lock) follow the seat's keyboard state, and touchpads and
//! mice take the shell's settings (input/settings.rs); devices plugged in
//! later get both. A touchpad is turned off, or left to libinput to turn off
//! beside a mouse, as input/trackpad.rs says, again whenever a device comes or goes.

use smithay::{
    backend::{input::InputEvent, libinput::LibinputInputBackend},
    input::keyboard::LedState,
    reexports::input::{self as libinput, Device, DeviceCapability, Led, SendEventsMode},
};

use crate::input::{
    Pointers,
    settings::{AccelProfile, ClickMethod, InputSettings, PointerSettings},
    trackpad::{self, Pointer, SendEvents},
};

pub(super) struct InputDevices {
    keyboards: Vec<Device>,
    pointers: Vec<(Device, Pointer)>,
    leds: Led,
    settings: InputSettings,
}

impl Default for InputDevices {
    fn default() -> Self {
        Self {
            keyboards: Vec::new(),
            pointers: Vec::new(),
            leds: Led::empty(),
            settings: InputSettings::default(),
        }
    }
}

impl InputDevices {
    /// Keep track of devices as libinput finds and loses them. Answers which
    /// kinds of pointer are connected now, if that changed.
    pub(super) fn device_event(
        &mut self,
        event: &InputEvent<LibinputInputBackend>,
    ) -> Option<Pointers> {
        let before = self.pointers();
        match event {
            InputEvent::DeviceAdded { device } => {
                let mut device = device.clone();
                if device.has_capability(DeviceCapability::Keyboard) {
                    device.led_update(self.leds);
                    self.keyboards.push(device.clone());
                }
                if device.has_capability(DeviceCapability::Pointer) {
                    configure(&mut device, &self.settings);
                    let kind = describe(&device);
                    self.pointers.push((device, kind));
                }
            }
            InputEvent::DeviceRemoved { device } => {
                self.keyboards.retain(|d| d != device);
                self.pointers.retain(|(d, _)| d != device);
            }
            _ => {}
        }
        self.listen_to_touchpads(true);
        let after = self.pointers();
        (after != before).then_some(after)
    }

    pub(super) fn apply_input(&mut self, settings: &InputSettings) {
        self.settings = settings.clone();
        for (device, _) in &mut self.pointers {
            configure(device, settings);
        }
        self.listen_to_touchpads(false);
    }

    /// Which kinds of pointer device are connected.
    pub(super) fn pointers(&self) -> Pointers {
        trackpad::connected(self.pointers.iter().map(|(_, kind)| kind))
    }

    /// Each touchpad on, off, or off beside a mouse (input/trackpad.rs); `devices_changed`
    /// when a device just came or went.
    fn listen_to_touchpads(&mut self, devices_changed: bool) {
        let mouse = self.pointers().mouse;
        for (device, kind) in &mut self.pointers {
            if !kind.touchpad {
                continue;
            }
            let mode = match trackpad::send_events(&self.settings.touchpad, *kind, mouse) {
                SendEvents::Enabled => SendEventsMode::ENABLED,
                SendEvents::Disabled => SendEventsMode::DISABLED,
                SendEvents::DisabledOnExternalMouse => SendEventsMode::DISABLED_ON_EXTERNAL_MOUSE,
            };
            if device.config_send_events_mode() == mode {
                // libinput looks for a mouse when the mode is set; one plugged in later
                // did not stop the touchpad (libinput 1.31), so it is asked to look again.
                if !(devices_changed && mode == SendEventsMode::DISABLED_ON_EXTERNAL_MOUSE) {
                    continue;
                }
                if let Err(error) = device.config_send_events_set_mode(SendEventsMode::ENABLED) {
                    tracing::debug!(device = device.name(), ?error, "a touchpad on or off");
                }
            }
            if let Err(error) = device.config_send_events_set_mode(mode) {
                tracing::debug!(device = device.name(), ?error, "a touchpad on or off");
            }
        }
    }

    pub(super) fn set_leds(&mut self, state: LedState) {
        let mut leds = self.leds;
        for (on, led) in [
            (state.caps, Led::CAPSLOCK),
            (state.num, Led::NUMLOCK),
            (state.scroll, Led::SCROLLLOCK),
        ] {
            if let Some(on) = on {
                leds.set(led, on);
            }
        }
        self.leds = leds;
        for device in &mut self.keyboards {
            device.led_update(leds);
        }
    }
}

/// What input/trackpad.rs asks of a pointer device.
fn describe(device: &Device) -> Pointer {
    let (udev_mouse, bus) = udev_facts(device);
    Pointer {
        touchpad: device.config_tap_finger_count() > 0,
        mouse: trackpad::external_mouse(udev_mouse, bus),
        own_mouse_mode: device
            .config_send_events_modes()
            .contains(SendEventsMode::DISABLED_ON_EXTERNAL_MOUSE),
    }
}

/// Whether udev calls the device a mouse, and the bus its input device is on
/// (`id/bustype`, hexadecimal, as libinput reads it).
fn udev_facts(device: &Device) -> (bool, Option<u16>) {
    // SAFETY: libinput was made from udev (`Libinput::new_with_udev`, start.rs), so the
    // device it hands back is its own, on its own udev context, and is kept for this call only.
    let Some(udev) = (unsafe { device.udev_device() }) else {
        return (false, None);
    };
    let mouse = udev
        .property_value("ID_INPUT_MOUSE")
        .is_some_and(|value| value == "1");
    let bus = udev
        .parent()
        .and_then(|input| {
            input
                .attribute_value("id/bustype")
                .and_then(|bus| bus.to_str().map(str::to_owned))
        })
        .and_then(|bus| u16::from_str_radix(bus.trim(), 16).ok());
    (mouse, bus)
}

/// A touchpad (it can tap) takes the touchpad settings; any other pointer the mouse's.
fn configure(device: &mut Device, settings: &InputSettings) {
    let touchpad = device.config_tap_finger_count() > 0;
    let wanted = if touchpad {
        &settings.touchpad
    } else {
        &settings.mouse
    };
    if let Err(error) = apply(device, wanted, touchpad) {
        tracing::debug!(device = device.name(), ?error, "a pointer setting");
    }
}

fn apply(
    device: &mut Device,
    s: &PointerSettings,
    touchpad: bool,
) -> Result<(), libinput::DeviceConfigError> {
    if touchpad {
        device
            .config_tap_set_enabled(s.tap.unwrap_or_else(|| device.config_tap_default_enabled()))?;
        let dwt = s
            .disable_while_typing
            .unwrap_or_else(|| device.config_dwt_default_enabled());
        device.config_dwt_set_enabled(dwt)?;
        let method = match s.click_method {
            Some(ClickMethod::ButtonAreas) => Some(libinput::ClickMethod::ButtonAreas),
            Some(ClickMethod::Clickfinger) => Some(libinput::ClickMethod::Clickfinger),
            None => device.config_click_default_method(),
        };
        if let Some(method) = method
            && device.config_click_methods().contains(&method)
        {
            device.config_click_set_method(method)?;
        }
    }
    if device.config_scroll_has_natural_scroll() {
        let natural = s
            .natural_scroll
            .unwrap_or_else(|| device.config_scroll_default_natural_scroll_enabled());
        device.config_scroll_set_natural_scroll_enabled(natural)?;
    }
    if device.config_accel_is_available() {
        device.config_accel_set_speed(
            s.accel_speed
                .unwrap_or_else(|| device.config_accel_default_speed()),
        )?;
        let profile = match s.accel_profile {
            Some(AccelProfile::Flat) => Some(libinput::AccelProfile::Flat),
            Some(AccelProfile::Adaptive) => Some(libinput::AccelProfile::Adaptive),
            None => device.config_accel_default_profile(),
        };
        if let Some(profile) = profile
            && device.config_accel_profiles().contains(&profile)
        {
            device.config_accel_set_profile(profile)?;
        }
    }
    Ok(())
}
