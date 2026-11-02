//! The input devices libinput finds: the keyboards' lights (Caps Lock, Num
//! Lock, Scroll Lock) follow the seat's keyboard state, and touchpads and
//! mice take the shell's settings (input/settings.rs); devices plugged in
//! later get both.

use smithay::{
    backend::{input::InputEvent, libinput::LibinputInputBackend},
    input::keyboard::LedState,
    reexports::input::{self as libinput, Device, DeviceCapability, Led},
};

use crate::input::settings::{AccelProfile, ClickMethod, InputSettings, PointerSettings};

pub(super) struct InputDevices {
    keyboards: Vec<Device>,
    pointers: Vec<Device>,
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
    /// Keep track of devices as libinput finds and loses them.
    pub(super) fn device_event(&mut self, event: &InputEvent<LibinputInputBackend>) {
        match event {
            InputEvent::DeviceAdded { device } => {
                let mut device = device.clone();
                if device.has_capability(DeviceCapability::Keyboard) {
                    device.led_update(self.leds);
                    self.keyboards.push(device.clone());
                }
                if device.has_capability(DeviceCapability::Pointer) {
                    configure(&mut device, &self.settings);
                    self.pointers.push(device);
                }
            }
            InputEvent::DeviceRemoved { device } => {
                self.keyboards.retain(|d| d != device);
                self.pointers.retain(|d| d != device);
            }
            _ => {}
        }
    }

    pub(super) fn apply_input(&mut self, settings: &InputSettings) {
        self.settings = settings.clone();
        for device in &mut self.pointers {
            configure(device, settings);
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
