//! The keyboards' lights (Caps Lock, Num Lock, Scroll Lock) follow the seat's
//! keyboard state, on every keyboard, including ones plugged in later.

use smithay::{
    backend::{input::InputEvent, libinput::LibinputInputBackend},
    input::keyboard::LedState,
    reexports::input::{Device, DeviceCapability, Led},
};

pub(super) struct Keyboards {
    devices: Vec<Device>,
    leds: Led,
}

impl Default for Keyboards {
    fn default() -> Self {
        Self {
            devices: Vec::new(),
            leds: Led::empty(),
        }
    }
}

impl Keyboards {
    /// Keep track of keyboards as libinput finds and loses them.
    pub(super) fn device_event(&mut self, event: &InputEvent<LibinputInputBackend>) {
        match event {
            InputEvent::DeviceAdded { device }
                if device.has_capability(DeviceCapability::Keyboard) =>
            {
                let mut device = device.clone();
                device.led_update(self.leds);
                self.devices.push(device);
            }
            InputEvent::DeviceRemoved { device } => self.devices.retain(|d| d != device),
            _ => {}
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
        for device in &mut self.devices {
            device.led_update(leds);
        }
    }
}
