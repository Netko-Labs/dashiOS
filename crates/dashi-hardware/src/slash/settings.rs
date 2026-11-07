//! What the Slash bar is set to (the helper's saved copy: the bar can't be
//! read back), a change to it as `SetSlash` or the CLI asks, and the packets
//! that take the bar from one to the other.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use super::packet::{self, MODES, Show};

/// The interval's range (asusctl's CLI and rog-control-center: 0–5).
pub(crate) const INTERVAL_MAX: u8 = 5;
/// The brightness asusd uses when the bar is turned on at 0 (`0x88`).
const ON_BRIGHTNESS: u8 = 0x88;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Settings {
    pub(crate) enabled: bool,
    /// An animation's name (`packet::MODES`).
    pub(crate) mode: String,
    pub(crate) brightness: u8,
    pub(crate) interval: u8,
    pub(crate) show_on_boot: bool,
    pub(crate) show_on_shutdown: bool,
    pub(crate) show_on_sleep: bool,
    pub(crate) show_on_battery: bool,
    pub(crate) show_battery_warning: bool,
    pub(crate) show_on_lid_closed: bool,
}

/// asusd's defaults (`asusd/src/aura_slash/config.rs`).
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: "bounce".into(),
            brightness: 255,
            interval: 0,
            show_on_boot: true,
            show_on_shutdown: true,
            show_on_sleep: true,
            show_on_battery: true,
            show_battery_warning: true,
            show_on_lid_closed: true,
        }
    }
}

impl Settings {
    /// A saved copy made valid: an unknown animation becomes the default,
    /// the interval is clamped.
    pub(crate) fn sanitized(mut self) -> Self {
        if packet::mode_byte(&self.mode).is_none() {
            self.mode = Settings::default().mode;
        }
        self.interval = self.interval.min(INTERVAL_MAX);
        self
    }

    pub(crate) fn show(&self, flag: Show) -> bool {
        match flag {
            Show::Boot => self.show_on_boot,
            Show::Shutdown => self.show_on_shutdown,
            Show::Sleep => self.show_on_sleep,
            Show::Battery => self.show_on_battery,
            Show::BatteryWarning => self.show_battery_warning,
            Show::LidClosed => self.show_on_lid_closed,
        }
    }

    fn set_show(&mut self, flag: Show, on: bool) {
        let field = match flag {
            Show::Boot => &mut self.show_on_boot,
            Show::Shutdown => &mut self.show_on_shutdown,
            Show::Sleep => &mut self.show_on_sleep,
            Show::Battery => &mut self.show_on_battery,
            Show::BatteryWarning => &mut self.show_battery_warning,
            Show::LidClosed => &mut self.show_on_lid_closed,
        };
        *field = on;
    }

    fn mode_byte(&self) -> u8 {
        packet::mode_byte(&self.mode).unwrap_or(0x10)
    }

    /// The settings as `Slash()` reports them, flat (the keys `SetSlash` takes).
    pub(crate) fn json(&self) -> Map<String, Value> {
        let mut map = Map::new();
        map.insert("enabled".into(), json!(self.enabled));
        map.insert("mode".into(), json!(self.mode));
        map.insert("brightness".into(), json!(self.brightness));
        map.insert("interval".into(), json!(self.interval));
        for flag in Show::ALL {
            map.insert(flag.key().into(), json!(self.show(flag)));
        }
        map
    }

    /// These settings with `change` applied, asusd's way: turning the bar on
    /// at brightness 0 turns it on at `0x88`; a brightness without `enabled`
    /// turns the bar on above 0 and off at 0 (`trait_impls.rs`).
    pub(crate) fn with(&self, change: &Change) -> Settings {
        let mut next = self.clone();
        if let Some(brightness) = change.brightness {
            next.brightness = brightness;
            next.enabled = brightness > 0;
        }
        if let Some(enabled) = change.enabled {
            next.enabled = enabled;
            if enabled && next.brightness == 0 {
                next.brightness = ON_BRIGHTNESS;
            }
        }
        if let Some(interval) = change.interval {
            next.interval = interval;
        }
        if let Some(mode) = &change.mode {
            next.mode = mode.clone();
        }
        for (flag, on) in &change.show {
            next.set_show(*flag, *on);
        }
        next
    }

    /// The packets from `self` to `next`, only for what differs, in asusd's
    /// order per property.
    pub(crate) fn packets_to(&self, next: &Settings, report: u8) -> Vec<Vec<u8>> {
        let mut packets = Vec::new();
        if next.enabled != self.enabled {
            packets.push(packet::enable(report, next.enabled));
        }
        if (next.enabled, next.brightness, next.interval)
            != (self.enabled, self.brightness, self.interval)
        {
            packets.push(next.options_packet(report));
        }
        if next.mode != self.mode {
            packets.push(packet::mode(report, next.mode_byte()));
            packets.push(packet::save(report));
        }
        for flag in Show::ALL {
            if next.show(flag) != self.show(flag) {
                packets.push(flag.packet(report, next.show(flag)));
                if flag == Show::LidClosed {
                    packets.push(packet::save(report));
                }
            }
        }
        packets
    }

    /// Everything, for a bar that forgot: asusd's start-up sequence
    /// (`Slash::do_initialization`, then `SlashZbus::reload`'s flags). asusd
    /// re-sends neither the lid-closed flag nor a save here; nor does this.
    pub(crate) fn restore_packets(&self, report: u8) -> Vec<Vec<u8>> {
        let mut packets: Vec<Vec<u8>> = packet::init(report).into();
        packets.push(packet::enable(report, self.enabled));
        packets.push(self.options_packet(report));
        packets.push(packet::mode(report, self.mode_byte()));
        for flag in [
            Show::Boot,
            Show::Sleep,
            Show::Shutdown,
            Show::Battery,
            Show::BatteryWarning,
        ] {
            packets.push(flag.packet(report, self.show(flag)));
        }
        packets
    }

    fn options_packet(&self, report: u8) -> Vec<u8> {
        packet::options(report, self.enabled, self.brightness, self.interval)
    }
}

/// One value of a change, from D-Bus or the command line.
#[derive(Clone, Debug)]
pub(crate) enum Input {
    Bool(bool),
    Int(i64),
    Str(String),
}

impl Input {
    /// A command-line word: a boolean word, a whole number, or text.
    pub(crate) fn from_text(text: &str) -> Input {
        match text {
            "true" | "on" | "yes" => Input::Bool(true),
            "false" | "off" | "no" => Input::Bool(false),
            _ => text
                .parse::<i64>()
                .map(Input::Int)
                .unwrap_or_else(|_| Input::Str(text.to_owned())),
        }
    }
}

/// What a `SetSlash` asks for; absent keys stay as they are.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Change {
    pub(crate) enabled: Option<bool>,
    pub(crate) mode: Option<String>,
    pub(crate) brightness: Option<u8>,
    pub(crate) interval: Option<u8>,
    pub(crate) show: Vec<(Show, bool)>,
}

impl Change {
    /// Take one key: validated (the type, the animation's name), numbers
    /// clamped (brightness 0–255, interval 0–5).
    pub(crate) fn put(&mut self, key: &str, value: Input) -> Result<(), String> {
        let boolean = |value: &Input| match value {
            Input::Bool(b) => Ok(*b),
            Input::Int(n @ (0 | 1)) => Ok(*n == 1),
            _ => Err(format!("{key}: expected a boolean")),
        };
        let number = |value: &Input, max: u8| match value {
            Input::Int(n) => Ok((*n).clamp(0, i64::from(max)) as u8),
            _ => Err(format!("{key}: expected a number")),
        };
        match key {
            "enabled" => self.enabled = Some(boolean(&value)?),
            "brightness" => self.brightness = Some(number(&value, u8::MAX)?),
            "interval" => self.interval = Some(number(&value, INTERVAL_MAX)?),
            "mode" => match value {
                Input::Str(name) if packet::mode_byte(&name).is_some() => self.mode = Some(name),
                Input::Str(name) => {
                    let names: Vec<&str> = MODES.iter().map(|(id, _)| *id).collect();
                    return Err(format!(
                        "mode: {name} is not an animation ({})",
                        names.join(", ")
                    ));
                }
                _ => return Err("mode: expected an animation's name".into()),
            },
            _ => match Show::from_key(key) {
                Some(flag) => self.show.push((flag, boolean(&value)?)),
                None => return Err(format!("{key} is not a Slash setting")),
            },
        }
        Ok(())
    }
}
