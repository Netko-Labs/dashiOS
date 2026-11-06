//! `platform-profile`: every platform profile handler at once.
//!
//! The legacy file (`/sys/firmware/acpi/platform_profile`) writes all the
//! handlers in `/sys/class/platform-profile/` together, mapping names where
//! one handler calls a profile differently (asus-wmi's `quiet` is amd-pmf's
//! `low-power`). Dashi's names are `low-power`, `balanced`, `performance`.

use std::io;

use super::{Backend, Found, Knob, Spec, Value};
use crate::sysfs::Sysfs;

const LEGACY: &str = "firmware/acpi/platform_profile";
const LEGACY_CHOICES: &str = "firmware/acpi/platform_profile_choices";
const CLASS: &str = "class/platform-profile";
const DASHI: [&str; 3] = ["low-power", "balanced", "performance"];

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Profile {
    legacy: Option<Vec<String>>,
    /// Handler directories, with each one's own choices.
    handlers: Vec<(String, Vec<String>)>,
}

/// A kernel profile name in Dashi's words.
pub(crate) fn to_dashi(name: &str) -> &str {
    match name {
        "quiet" => "low-power",
        other => other,
    }
}

/// Dashi's name as a handler with `choices` spells it.
fn to_kernel<'a>(name: &'a str, choices: &[String]) -> Option<&'a str> {
    if choices.iter().any(|c| c == name) {
        return Some(name);
    }
    (name == "low-power" && choices.iter().any(|c| c == "quiet")).then_some("quiet")
}

fn words(text: Option<String>) -> Vec<String> {
    text.map(|t| t.split_whitespace().map(str::to_owned).collect())
        .unwrap_or_default()
}

pub(super) fn discover(sysfs: &Sysfs) -> Option<Found> {
    let legacy = sysfs
        .exists(LEGACY)
        .then(|| words(sysfs.read(LEGACY_CHOICES)))
        .filter(|choices| !choices.is_empty());
    let handlers: Vec<(String, Vec<String>)> = sysfs
        .list(CLASS)
        .into_iter()
        .filter(|name| sysfs.exists(&format!("{CLASS}/{name}/profile")))
        .map(|name| {
            let choices = words(sysfs.read(&format!("{CLASS}/{name}/choices")));
            (name, choices)
        })
        .collect();
    let offered: Vec<String> = match (&legacy, handlers.first()) {
        (Some(choices), _) => choices.clone(),
        (None, Some((_, choices))) => choices.clone(),
        (None, None) => return None,
    };
    let choices: Vec<String> = DASHI
        .iter()
        .filter(|name| to_kernel(name, &offered).is_some())
        .map(|name| (*name).to_owned())
        .collect();
    if choices.is_empty() {
        return None;
    }
    Some(Found {
        knob: Knob::PlatformProfile,
        spec: Spec::Choices(choices),
        backend: Backend::Profile(Profile { legacy, handlers }),
    })
}

impl Profile {
    /// The files that notify (poll) when the profile changes.
    pub(crate) fn watched(&self) -> Vec<String> {
        let mut files: Vec<String> = self
            .handlers
            .iter()
            .map(|(name, _)| format!("{CLASS}/{name}/profile"))
            .collect();
        if self.legacy.is_some() {
            files.push(LEGACY.to_owned());
        }
        files
    }

    pub(super) fn read(&self, sysfs: &Sysfs) -> Option<Value> {
        let legacy = self.legacy.as_ref().and_then(|_| sysfs.read(LEGACY));
        // "custom" when the handlers disagree: the first handler speaks then.
        let name = match legacy {
            Some(name) if name != "custom" => name,
            _ => {
                let (handler, _) = self.handlers.first()?;
                sysfs.read(&format!("{CLASS}/{handler}/profile"))?
            }
        };
        Some(Value::Str(to_dashi(&name).to_owned()))
    }

    pub(super) fn write(&self, sysfs: &Sysfs, value: &Value) -> io::Result<()> {
        let Value::Str(name) = value else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a profile is a string",
            ));
        };
        if let Some(choices) = &self.legacy
            && let Some(kernel) = to_kernel(name, choices)
            && sysfs.write(LEGACY, kernel).is_ok()
        {
            // The kernel passes it on to every handler; a fake tree can't.
            if sysfs.is_fake() {
                self.write_handlers(sysfs, name)?;
            }
            return Ok(());
        }
        self.write_handlers(sysfs, name)
    }

    fn write_handlers(&self, sysfs: &Sysfs, name: &str) -> io::Result<()> {
        // Each handler in its own words.
        let mut wrote = false;
        for (handler, choices) in &self.handlers {
            if let Some(kernel) = to_kernel(name, choices) {
                sysfs.write(&format!("{CLASS}/{handler}/profile"), kernel)?;
                wrote = true;
            }
        }
        if wrote {
            Ok(())
        } else {
            Err(io::Error::new(
                io::ErrorKind::NotFound,
                "no profile handler takes it",
            ))
        }
    }
}
