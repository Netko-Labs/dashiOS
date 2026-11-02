//! Touchpad and mouse settings (`input`), as the shell's settings name them:
//! tap to click, natural scrolling, pointer speed and profile, disable while
//! typing, the click method, and a scroll speed factor. The backend that has
//! the devices (udev, through libinput) configures them, plugged in now or
//! later; a key left out is the device's own default. The scroll factor is
//! the compositor's: it scales what a touchpad's or a wheel's scroll moves.

use serde_json::{Map, Value};
use smithay::backend::input::AxisSource;

use crate::state::Dashi;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccelProfile {
    Flat,
    Adaptive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

fn parse_pointer(
    value: Option<&Value>,
    what: &str,
    touchpad: bool,
) -> Result<PointerSettings, String> {
    let Some(value) = value else {
        return Ok(PointerSettings::default());
    };
    let map = value
        .as_object()
        .ok_or_else(|| format!("`{what}` must be an object"))?;
    let flag = |key: &str| -> Result<Option<bool>, String> {
        match map.get(key) {
            None => Ok(None),
            Some(v) => v
                .as_bool()
                .map(Some)
                .ok_or_else(|| format!("`{what}.{key}` must be true or false")),
        }
    };
    let number = |key: &str, low: f64, high: f64| -> Result<Option<f64>, String> {
        match map.get(key) {
            None => Ok(None),
            Some(v) => v
                .as_f64()
                .filter(|n| (low..=high).contains(n))
                .map(Some)
                .ok_or_else(|| format!("`{what}.{key}` must be from {low} to {high}")),
        }
    };
    let accel_profile = match map.get("accelProfile").map(Value::as_str) {
        None => None,
        Some(Some("flat")) => Some(AccelProfile::Flat),
        Some(Some("adaptive")) => Some(AccelProfile::Adaptive),
        Some(_) => return Err(format!("`{what}.accelProfile` must be flat or adaptive")),
    };
    let click_method = match map.get("clickMethod").map(Value::as_str) {
        None => None,
        Some(Some("buttonAreas")) if touchpad => Some(ClickMethod::ButtonAreas),
        Some(Some("clickfinger")) if touchpad => Some(ClickMethod::Clickfinger),
        Some(_) => {
            return Err(format!(
                "`{what}.clickMethod` must be buttonAreas or clickfinger"
            ));
        }
    };
    let only_touchpad = |value: Option<bool>, key: &str| -> Result<Option<bool>, String> {
        if value.is_some() && !touchpad {
            return Err(format!("`{what}.{key}` is for touchpads"));
        }
        Ok(value)
    };
    Ok(PointerSettings {
        tap: only_touchpad(flag("tap")?, "tap")?,
        natural_scroll: flag("naturalScroll")?,
        accel_speed: number("accelSpeed", -1.0, 1.0)?,
        accel_profile,
        disable_while_typing: only_touchpad(flag("disableWhileTyping")?, "disableWhileTyping")?,
        click_method,
        scroll_speed: number("scrollSpeed", 0.25, 4.0)?,
    })
}

/// `input {touchpad?, mouse?}`, checked whole before anything changes.
pub(crate) fn parse(params: &Map<String, Value>) -> Result<InputSettings, String> {
    Ok(InputSettings {
        touchpad: parse_pointer(params.get("touchpad"), "touchpad", true)?,
        mouse: parse_pointer(params.get("mouse"), "mouse", false)?,
    })
}

impl Dashi {
    pub(crate) fn set_input(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let settings = parse(params)?;
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
    use serde_json::json;

    fn of(value: Value) -> Result<InputSettings, String> {
        parse(value.as_object().expect("an object"))
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
                .contains("touchpads")
        );
        assert!(of(json!({ "touchpad": { "clickMethod": "both" } })).is_err());
        assert!(of(json!({ "mouse": "fast" })).is_err());
    }
}
