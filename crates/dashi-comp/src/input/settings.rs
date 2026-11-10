//! Touchpad and mouse settings (`input`), as the shell's settings name them:
//! tap to click, natural scrolling, pointer speed and profile, disable while
//! typing, the click method, and a scroll speed factor. The backend that has
//! the devices (udev, through libinput) configures them, plugged in now or
//! later; a key left out is the device's own default. The scroll factor is
//! the compositor's: it scales what a touchpad's or a wheel's scroll moves.

use serde::{Deserialize, Serialize};
use smithay::backend::input::AxisSource;

use crate::{ipc::protocol::Real, state::Dashi};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AccelProfile {
    Flat,
    Adaptive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClickMethod {
    ButtonAreas,
    Clickfinger,
}

/// One kind of pointer's settings; None is the device's default.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct PointerSettings {
    pub tap: Option<bool>,
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<f64>,
    pub accel_profile: Option<AccelProfile>,
    pub disable_while_typing: Option<bool>,
    pub click_method: Option<ClickMethod>,
    pub scroll_speed: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct InputSettings {
    pub touchpad: PointerSettings,
    pub mouse: PointerSettings,
}

/// `input`'s params (docs/compositor-ipc.md): a key left out is the device's default.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InputParams {
    #[serde(default)]
    pub touchpad: TouchpadParams,
    #[serde(default)]
    pub mouse: MouseParams,
}

/// Pointer speed, -1 to 1.
type Speed = Real<-1000, 1000>;
/// How far a scroll goes, 0.25 to 4 times.
type ScrollSpeed = Real<250, 4000>;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TouchpadParams {
    pub tap: Option<bool>,
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<Speed>,
    pub accel_profile: Option<AccelProfile>,
    pub disable_while_typing: Option<bool>,
    pub click_method: Option<ClickMethod>,
    pub scroll_speed: Option<ScrollSpeed>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MouseParams {
    pub natural_scroll: Option<bool>,
    pub accel_speed: Option<Speed>,
    pub accel_profile: Option<AccelProfile>,
    pub scroll_speed: Option<ScrollSpeed>,
}

impl From<&InputParams> for InputSettings {
    fn from(params: &InputParams) -> Self {
        let (touchpad, mouse) = (&params.touchpad, &params.mouse);
        Self {
            touchpad: PointerSettings {
                tap: touchpad.tap,
                natural_scroll: touchpad.natural_scroll,
                accel_speed: touchpad.accel_speed.map(Speed::get),
                accel_profile: touchpad.accel_profile,
                disable_while_typing: touchpad.disable_while_typing,
                click_method: touchpad.click_method,
                scroll_speed: touchpad.scroll_speed.map(ScrollSpeed::get),
            },
            mouse: PointerSettings {
                natural_scroll: mouse.natural_scroll,
                accel_speed: mouse.accel_speed.map(Speed::get),
                accel_profile: mouse.accel_profile,
                scroll_speed: mouse.scroll_speed.map(ScrollSpeed::get),
                ..PointerSettings::default()
            },
        }
    }
}

impl Dashi {
    pub(crate) fn set_input(&mut self, params: &InputParams) -> Result<(), String> {
        let settings = InputSettings::from(params);
        self.backend.apply_input(&settings);
        self.input_settings = settings;
        Ok(())
    }

    /// How far a scroll from `source` goes: a touchpad's (finger, continuous) or a wheel's.
    pub(crate) fn scroll_factor(&self, source: AxisSource) -> f64 {
        let settings = match source {
            AxisSource::Finger | AxisSource::Continuous => &self.input_settings.touchpad,
            AxisSource::Wheel | AxisSource::WheelTilt => &self.input_settings.mouse,
        };
        settings.scroll_speed.unwrap_or(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn of(value: Value) -> Result<InputSettings, String> {
        crate::ipc::protocol::read::<InputParams>(value).map(|params| InputSettings::from(&params))
    }

    #[test]
    fn the_shells_settings_read_as_they_are_written() {
        let settings = of(json!({
            "touchpad": { "tap": true, "naturalScroll": true, "accelSpeed": 0.3, "disableWhileTyping": true, "clickMethod": "clickfinger", "scrollSpeed": 1.5 },
            "mouse": { "naturalScroll": false, "accelSpeed": 0, "accelProfile": "flat", "scrollSpeed": 1 }
        }))
        .expect("valid settings");
        assert_eq!(settings.touchpad.tap, Some(true));
        assert_eq!(
            settings.touchpad.click_method,
            Some(ClickMethod::Clickfinger)
        );
        assert_eq!(settings.mouse.accel_profile, Some(AccelProfile::Flat));
        assert_eq!(settings.mouse.tap, None);
        assert_eq!(
            of(json!({})).expect("nothing is fine"),
            InputSettings::default()
        );
    }

    #[test]
    fn mistakes_change_nothing_and_say_what() {
        assert!(
            of(json!({ "touchpad": { "accelSpeed": 2 } }))
                .unwrap_err()
                .contains("accelSpeed")
        );
        assert!(
            of(json!({ "mouse": { "tap": true } }))
                .unwrap_err()
                .contains("unknown field `tap`")
        );
        assert!(of(json!({ "touchpad": { "clickMethod": "both" } })).is_err());
        assert!(of(json!({ "mouse": "fast" })).is_err());
    }
}
