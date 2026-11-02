//! The keyboard's layout and key repeat (`keyboard`): xkb layout, variant,
//! and options as the shell's settings name them, an empty name meaning the
//! system's own. The system's own comes from DASHI_XKB_LAYOUT, _VARIANT, and
//! _OPTIONS, else systemd-localed's /etc/X11/xorg.conf.d/00-keyboard.conf
//! (what `localectl set-x11-keymap` writes), read once at startup; so the
//! login screen types in the system's layout too.

use serde_json::{Map, Value};
use smithay::input::keyboard::XkbConfig;

use crate::state::Dashi;

/// localed's keyboard file.
const LOCALED: &str = "/etc/X11/xorg.conf.d/00-keyboard.conf";
/// Key repeat when nothing says otherwise: characters a second, and the delay in ms.
pub(crate) const DEFAULT_REPEAT: (i32, i32) = (25, 200);

/// An xkb layout, variant, and options (comma-separated name lists).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct XkbNames {
    pub layout: String,
    pub variant: String,
    pub options: String,
}

impl XkbNames {
    /// The system's layout: the environment's, else localed's file.
    pub(crate) fn system() -> Self {
        let var = |name: &str| std::env::var(name).ok().filter(|v| valid_names(v));
        if let Some(layout) = var("DASHI_XKB_LAYOUT") {
            return Self {
                layout,
                variant: var("DASHI_XKB_VARIANT").unwrap_or_default(),
                options: var("DASHI_XKB_OPTIONS").unwrap_or_default(),
            };
        }
        std::fs::read_to_string(LOCALED)
            .map(|text| parse_localed(&text))
            .unwrap_or_default()
    }

    pub(crate) fn config(&self) -> XkbConfig<'_> {
        XkbConfig {
            layout: &self.layout,
            variant: &self.variant,
            options: (!self.options.is_empty()).then(|| self.options.clone()),
            ..XkbConfig::default()
        }
    }
}

/// What the keyboard runs: the system's names, the shell's on top, and key repeat.
#[derive(Debug, Clone)]
pub(crate) struct KeyboardLayout {
    pub system: XkbNames,
    pub chosen: XkbNames,
    pub repeat: (i32, i32),
}

impl Default for KeyboardLayout {
    fn default() -> Self {
        Self {
            system: XkbNames::default(),
            chosen: XkbNames::default(),
            repeat: DEFAULT_REPEAT,
        }
    }
}

impl KeyboardLayout {
    /// The names in effect: each chosen one, else the system's.
    pub(crate) fn effective(&self) -> XkbNames {
        let pick =
            |chosen: &str, system: &str| if chosen.is_empty() { system } else { chosen }.to_owned();
        // A chosen layout brings its own variant: the system's would not fit it.
        let variant = if self.chosen.layout.is_empty() {
            pick(&self.chosen.variant, &self.system.variant)
        } else {
            self.chosen.variant.clone()
        };
        XkbNames {
            layout: pick(&self.chosen.layout, &self.system.layout),
            variant,
            options: pick(&self.chosen.options, &self.system.options),
        }
    }
}

/// An xkb name list as the shell's settings check it.
fn valid_names(value: &str) -> bool {
    value.len() <= 256
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_,:+.()-".contains(c))
}

/// `Option "XkbLayout" "us,de"` and the like, from localed's file.
fn parse_localed(text: &str) -> XkbNames {
    let mut names = XkbNames::default();
    for line in text.lines() {
        let mut quoted = line.split('"').skip(1).step_by(2);
        let (Some(key), Some(value)) = (quoted.next(), quoted.next()) else {
            continue;
        };
        if !line.trim_start().starts_with("Option") || !valid_names(value) {
            continue;
        }
        match key {
            "XkbLayout" => names.layout = value.to_owned(),
            "XkbVariant" => names.variant = value.to_owned(),
            "XkbOptions" => names.options = value.to_owned(),
            _ => {}
        }
    }
    names
}

impl Dashi {
    /// The system's layout, at startup (before any client has a keyboard).
    pub(crate) fn apply_system_layout(&mut self) {
        self.keys.layout.system = XkbNames::system();
        if self.keys.layout.system != XkbNames::default()
            && let Err(error) = self.apply_layout()
        {
            tracing::warn!(%error, "the system's keyboard layout");
        }
    }

    /// `keyboard {layout?, variant?, options?, repeatRate?, repeatDelay?}`.
    pub(crate) fn set_keyboard(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let text = |key: &str| -> Result<Option<String>, String> {
            match params.get(key) {
                None => Ok(None),
                Some(Value::String(v)) if valid_names(v) => Ok(Some(v.clone())),
                Some(_) => Err(format!("`{key}` must be an xkb name list such as us,de")),
            }
        };
        let number =
            |key: &str, range: std::ops::RangeInclusive<i64>| -> Result<Option<i32>, String> {
                match params.get(key) {
                    None => Ok(None),
                    Some(v) => v
                        .as_i64()
                        .filter(|n| range.contains(n))
                        .map(|n| Some(n as i32))
                        .ok_or_else(|| {
                            format!("`{key}` must be from {} to {}", range.start(), range.end())
                        }),
                }
            };
        let (layout, variant, options) = (text("layout")?, text("variant")?, text("options")?);
        let (rate, delay) = (
            number("repeatRate", 0..=100)?,
            number("repeatDelay", 100..=2000)?,
        );

        let before = self.keys.layout.clone();
        let chosen = &mut self.keys.layout.chosen;
        if let Some(layout) = layout {
            chosen.layout = layout;
        }
        if let Some(variant) = variant {
            chosen.variant = variant;
        }
        if let Some(options) = options {
            chosen.options = options;
        }
        if before.effective() != self.keys.layout.effective()
            && let Err(error) = self.apply_layout()
        {
            self.keys.layout = before;
            return Err(error);
        }
        if rate.is_some() || delay.is_some() {
            let (old_rate, old_delay) = self.keys.layout.repeat;
            self.keys.layout.repeat = (rate.unwrap_or(old_rate), delay.unwrap_or(old_delay));
            let (rate, delay) = self.keys.layout.repeat;
            for seat in self.seats() {
                if let Some(keyboard) = seat.get_keyboard() {
                    keyboard.change_repeat_info(rate, delay);
                }
            }
        }
        Ok(())
    }

    /// Compile the effective names into every seat's keymap; nothing changes if they do not compile.
    fn apply_layout(&mut self) -> Result<(), String> {
        let names = self.keys.layout.effective();
        for seat in self.seats() {
            let Some(keyboard) = seat.get_keyboard() else {
                continue;
            };
            keyboard.set_xkb_config(self, names.config()).map_err(|_| {
                format!(
                    "the layout {:?} ({:?}) does not compile",
                    names.layout, names.variant
                )
            })?;
        }
        Ok(())
    }

    fn seats(&self) -> Vec<smithay::input::Seat<Dashi>> {
        std::iter::once(self.seat.clone())
            .chain(self.agent.seat.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localed_names_the_layout() {
        let text = r#"# Written by systemd-localed(8)
Section "InputClass"
        Identifier "system-keyboard"
        MatchIsKeyboard "on"
        Option "XkbLayout" "us,es"
        Option "XkbVariant" ",nodeadkeys"
        Option "XkbOptions" "grp:alt_shift_toggle"
EndSection
"#;
        assert_eq!(
            parse_localed(text),
            XkbNames {
                layout: "us,es".into(),
                variant: ",nodeadkeys".into(),
                options: "grp:alt_shift_toggle".into()
            }
        );
        assert_eq!(
            parse_localed(r#"Option "XkbLayout" "us; rm -rf""#),
            XkbNames::default()
        );
    }

    #[test]
    fn a_chosen_layout_wins_and_brings_its_variant() {
        let layout = KeyboardLayout {
            system: XkbNames {
                layout: "de".into(),
                variant: "nodeadkeys".into(),
                options: "ctrl:nocaps".into(),
            },
            chosen: XkbNames {
                layout: "us".into(),
                ..XkbNames::default()
            },
            repeat: DEFAULT_REPEAT,
        };
        assert_eq!(
            layout.effective(),
            XkbNames {
                layout: "us".into(),
                variant: String::new(),
                options: "ctrl:nocaps".into()
            }
        );
    }
}
