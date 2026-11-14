//! When a touchpad is listened to: never while the person turned it off
//! (`input.touchpad.off`, the laptop's touchpad key), and not while a mouse is
//! connected if they asked for that (`offWithMouse`). libinput has a mode for
//! the second on a laptop's own touchpad (`disabled-on-external-mouse`); a
//! touchpad without it (one on USB or Bluetooth) is turned off and on here,
//! by the same rule libinput uses for what a mouse is. The backend with the
//! devices carries the answer out (backend/udev/input_devices.rs).

use serde::{Deserialize, Serialize};

use super::settings::PointerSettings;

/// libinput's send-events modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SendEvents {
    Enabled,
    Disabled,
    DisabledOnExternalMouse,
}

/// What these rules need to know of one pointer device.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Pointer {
    /// It can tap: a touchpad.
    pub touchpad: bool,
    /// A mouse someone plugged in or paired (`external_mouse`).
    pub mouse: bool,
    /// libinput can turn it off by itself while a mouse is connected.
    pub own_mouse_mode: bool,
}

/// The kernel's bus numbers for USB and Bluetooth (linux/input.h).
const BUS_USB: u16 = 0x03;
const BUS_BLUETOOTH: u16 = 0x05;

/// libinput's own rule for an external mouse: udev calls it a mouse, and it
/// is on USB or Bluetooth. A laptop's trackpoint (PS/2, I2C) is not one.
pub(crate) fn external_mouse(udev_mouse: bool, bus: Option<u16>) -> bool {
    udev_mouse && matches!(bus, Some(BUS_USB | BUS_BLUETOOTH))
}

/// How `pad` is to send its events, with the person's settings and whether a mouse is connected.
pub(crate) fn send_events(
    settings: &PointerSettings,
    pad: Pointer,
    mouse_connected: bool,
) -> SendEvents {
    if settings.off == Some(true) {
        return SendEvents::Disabled;
    }
    if settings.off_with_mouse != Some(true) {
        return SendEvents::Enabled;
    }
    if pad.own_mouse_mode {
        return SendEvents::DisabledOnExternalMouse;
    }
    if mouse_connected {
        SendEvents::Disabled
    } else {
        SendEvents::Enabled
    }
}

/// Which kinds of pointer device are connected (`pointers`, and the event of that name).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Pointers {
    pub touchpad: bool,
    pub mouse: bool,
}

pub(crate) fn connected<'a>(devices: impl IntoIterator<Item = &'a Pointer>) -> Pointers {
    let mut found = Pointers::default();
    for device in devices {
        found.touchpad |= device.touchpad;
        found.mouse |= device.mouse && !device.touchpad;
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP_PAD: Pointer = Pointer {
        touchpad: true,
        mouse: false,
        own_mouse_mode: true,
    };
    const USB_PAD: Pointer = Pointer {
        touchpad: true,
        mouse: false,
        own_mouse_mode: false,
    };
    const MOUSE: Pointer = Pointer {
        touchpad: false,
        mouse: true,
        own_mouse_mode: false,
    };
    const TRACKPOINT: Pointer = Pointer {
        touchpad: false,
        mouse: false,
        own_mouse_mode: false,
    };

    fn settings(off: Option<bool>, off_with_mouse: Option<bool>) -> PointerSettings {
        PointerSettings {
            off,
            off_with_mouse,
            ..PointerSettings::default()
        }
    }

    #[test]
    fn a_touchpad_is_listened_to_until_someone_says_otherwise() {
        for mouse in [false, true] {
            for pad in [LAPTOP_PAD, USB_PAD] {
                assert_eq!(
                    send_events(&settings(None, None), pad, mouse),
                    SendEvents::Enabled
                );
                assert_eq!(
                    send_events(&settings(Some(false), Some(false)), pad, mouse),
                    SendEvents::Enabled
                );
            }
        }
    }

    #[test]
    fn turned_off_it_is_off_whatever_else_is_set() {
        for mouse in [false, true] {
            for with_mouse in [None, Some(true)] {
                for pad in [LAPTOP_PAD, USB_PAD] {
                    assert_eq!(
                        send_events(&settings(Some(true), with_mouse), pad, mouse),
                        SendEvents::Disabled
                    );
                }
            }
        }
    }

    #[test]
    fn a_laptops_own_touchpad_is_left_to_libinput() {
        let wanted = settings(None, Some(true));
        for mouse in [false, true] {
            assert_eq!(
                send_events(&wanted, LAPTOP_PAD, mouse),
                SendEvents::DisabledOnExternalMouse
            );
        }
    }

    #[test]
    fn a_touchpad_without_the_mode_follows_the_mouse_coming_and_going() {
        let wanted = settings(None, Some(true));
        let mut devices = vec![USB_PAD, TRACKPOINT];
        let mode = |devices: &[Pointer]| send_events(&wanted, USB_PAD, connected(devices).mouse);
        assert_eq!(mode(&devices), SendEvents::Enabled);
        devices.push(MOUSE);
        assert_eq!(mode(&devices), SendEvents::Disabled);
        devices.retain(|device| !device.mouse);
        assert_eq!(mode(&devices), SendEvents::Enabled);
    }

    #[test]
    fn a_mouse_is_on_usb_or_bluetooth_and_udev_calls_it_one() {
        assert!(external_mouse(true, Some(BUS_USB)));
        assert!(external_mouse(true, Some(BUS_BLUETOOTH)));
        // A trackpoint (PS/2), a virtual pointer, a device with no bus to read.
        assert!(!external_mouse(true, Some(0x11)));
        assert!(!external_mouse(true, Some(0x06)));
        assert!(!external_mouse(true, None));
        // A USB keyboard udev does not call a mouse.
        assert!(!external_mouse(false, Some(BUS_USB)));
    }

    #[test]
    fn what_is_connected_is_said_by_kind() {
        assert_eq!(connected(&[]), Pointers::default());
        assert_eq!(
            connected(&[LAPTOP_PAD, TRACKPOINT]),
            Pointers {
                touchpad: true,
                mouse: false
            }
        );
        assert_eq!(
            connected(&[MOUSE]),
            Pointers {
                touchpad: false,
                mouse: true
            }
        );
        // A touchpad on USB that udev also calls a mouse is still a touchpad.
        let both = Pointer {
            mouse: true,
            ..USB_PAD
        };
        assert_eq!(
            connected(&[both]),
            Pointers {
                touchpad: true,
                mouse: false
            }
        );
    }
}
