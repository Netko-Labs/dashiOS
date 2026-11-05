//! Fans (hwmon `fanN_input`) and their curves (asus-wmi's
//! `asus_custom_fan_curve`: `pwmN_auto_pointM_temp`/`_pwm`, `pwmN_enable`).
//! hwmon numbers change between boots: devices are found by `name`.

use std::io;

use serde_json::json;

use crate::model::Model;
use crate::sysfs::Sysfs;

const HWMON: &str = "class/hwmon";
const CURVE_DEVICE: &str = "asus_custom_fan_curve";
/// Temperatures above this aren't a fan curve's business (°C).
const MAX_TEMP: u8 = 110;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Fan {
    pub(crate) id: String,
    hwmon: String,
    index: u32,
    /// The curve's hwmon directory and pwm index, when the fan has one.
    curve: Option<(String, u32)>,
}

fn hwmon_named(sysfs: &Sysfs, name: &str) -> Option<String> {
    sysfs
        .list(HWMON)
        .into_iter()
        .find(|dir| sysfs.read(&format!("{HWMON}/{dir}/name")).as_deref() == Some(name))
}

fn fan_indices(sysfs: &Sysfs, hwmon: &str) -> Vec<u32> {
    let mut indices: Vec<u32> = sysfs
        .list(&format!("{HWMON}/{hwmon}"))
        .iter()
        .filter_map(|file| file.strip_prefix("fan")?.strip_suffix("_input")?.parse().ok())
        .collect();
    indices.sort_unstable();
    indices
}

/// A fan's id from its label: `cpu_fan` is `cpu`; unlabeled ones are `fanN`.
fn fan_id(label: Option<String>, index: u32) -> String {
    label
        .and_then(|l| l.strip_suffix("_fan").map(str::to_owned))
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| format!("fan{index}"))
}

/// Every fan this machine reports. The ACPI fan device is a fallback only:
/// a vendor driver that reports fans knows them better.
pub(crate) fn discover(sysfs: &Sysfs) -> Vec<Fan> {
    let mut sources: Vec<(String, String)> = sysfs
        .list(HWMON)
        .into_iter()
        .filter_map(|dir| Some((sysfs.read(&format!("{HWMON}/{dir}/name"))?, dir)))
        .filter(|(_, dir)| !fan_indices(sysfs, dir).is_empty())
        .collect();
    if sources.iter().any(|(name, _)| name != "acpi_fan") {
        sources.retain(|(name, _)| name != "acpi_fan");
    }
    let curves = hwmon_named(sysfs, CURVE_DEVICE);
    let mut fans = Vec::new();
    for (name, dir) in sources {
        for index in fan_indices(sysfs, &dir) {
            let label = sysfs.read(&format!("{HWMON}/{dir}/fan{index}_label"));
            let curve = curves
                .as_ref()
                .filter(|_| name == "asus")
                .filter(|c| sysfs.exists(&format!("{HWMON}/{c}/pwm{index}_auto_point1_temp")))
                .map(|c| (c.clone(), index));
            let mut id = fan_id(label, index);
            if fans.iter().any(|f: &Fan| f.id == id) {
                id = format!("{id}{index}");
            }
            fans.push(Fan {
                id,
                hwmon: dir.clone(),
                index,
                curve,
            });
        }
    }
    fans
}

fn default_label(id: &str) -> String {
    match id {
        "cpu" => "CPU fan".into(),
        "gpu" => "Graphics fan".into(),
        "mid" => "Middle fan".into(),
        other => other.strip_prefix("fan").map_or_else(|| other.to_owned(), |n| format!("Fan {n}")),
    }
}

impl Fan {
    pub(crate) fn rpm(&self, sysfs: &Sysfs) -> Option<u64> {
        sysfs.read_u64(&format!("{HWMON}/{}/fan{}_input", self.hwmon, self.index))
    }

    pub(crate) fn describe(&self, sysfs: &Sysfs, model: Option<&Model>) -> serde_json::Value {
        let label = model
            .and_then(|m| m.fans.get(&self.id).cloned())
            .unwrap_or_else(|| default_label(&self.id));
        json!({"id": self.id, "label": label, "rpm": self.rpm(sysfs), "curve": self.curve.is_some()})
    }

    fn point_file(&self, point: usize, what: &str) -> Option<String> {
        let (dir, pwm) = self.curve.as_ref()?;
        Some(format!("{HWMON}/{dir}/pwm{pwm}_auto_point{point}_{what}"))
    }

    fn points(&self, sysfs: &Sysfs) -> usize {
        (1..=16)
            .take_while(|p| self.point_file(*p, "temp").is_some_and(|f| sysfs.exists(&f)))
            .count()
    }

    /// The curve: (°C, PWM 0–255) per point, or `None` without one.
    pub(crate) fn curve(&self, sysfs: &Sysfs) -> Option<Vec<(u8, u8)>> {
        let read = |p: usize, what: &str| -> Option<u8> {
            sysfs.read(&self.point_file(p, what)?)?.parse().ok()
        };
        (1..=self.points(sysfs))
            .map(|p| Some((read(p, "temp")?, read(p, "pwm")?)))
            .collect::<Option<Vec<_>>>()
            .filter(|points| !points.is_empty())
    }

    /// Write a curve and turn it on. Checked first: as many points as the
    /// firmware has, temperatures rising, PWM never falling.
    pub(crate) fn set_curve(&self, sysfs: &Sysfs, points: &[(u8, u8)]) -> Result<(), String> {
        let (dir, pwm) = self.curve.as_ref().ok_or("this fan has no curve")?;
        validate(points, self.points(sysfs))?;
        for (i, (temp, duty)) in points.iter().enumerate() {
            let write = |what: &str, value: u8| -> io::Result<()> {
                let file = self.point_file(i + 1, what).ok_or_else(|| io::Error::other("no curve"))?;
                sysfs.write(&file, &value.to_string())
            };
            write("temp", *temp).map_err(|e| e.to_string())?;
            write("pwm", *duty).map_err(|e| e.to_string())?;
        }
        sysfs
            .write(&format!("{HWMON}/{dir}/pwm{pwm}_enable"), "1")
            .map_err(|e| e.to_string())
    }

    /// Back to the firmware's own curve (asus-wmi: `pwmN_enable` 3).
    pub(crate) fn reset_curve(&self, sysfs: &Sysfs) -> io::Result<()> {
        match &self.curve {
            Some((dir, pwm)) => sysfs.write(&format!("{HWMON}/{dir}/pwm{pwm}_enable"), "3"),
            None => Ok(()),
        }
    }
}

pub(crate) fn validate(points: &[(u8, u8)], expected: usize) -> Result<(), String> {
    if points.len() != expected {
        return Err(format!("a curve has {expected} points, not {}", points.len()));
    }
    if let Some((temp, _)) = points.iter().find(|(t, _)| *t > MAX_TEMP) {
        return Err(format!("{temp} °C is above {MAX_TEMP} °C"));
    }
    for pair in points.windows(2) {
        let ((t0, p0), (t1, p1)) = (pair[0], pair[1]);
        if t1 <= t0 {
            return Err(format!("temperatures must rise: {t0} °C then {t1} °C"));
        }
        if p1 < p0 {
            return Err(format!("the fan can't slow down as it warms: {p0} then {p1}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sysfs::testing::TempTree;

    #[test]
    fn the_g14_has_two_fans_with_curves() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        let fans = discover(&sysfs);
        let ids: Vec<&str> = fans.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, ["cpu", "gpu"], "acpi_fan is left out beside asus");
        let cpu = &fans[0];
        let curve = cpu.curve(&sysfs).expect("the CPU fan has a curve");
        assert_eq!(curve.len(), 8);
        assert_eq!(curve[0], (45, 12));
        assert_eq!(cpu.describe(&sysfs, None)["label"], "CPU fan");
    }

    #[test]
    fn a_curve_is_checked_then_written_and_enabled() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        let gpu = discover(&sysfs).into_iter().find(|f| f.id == "gpu").expect("a GPU fan");
        let good: Vec<(u8, u8)> = (0..8).map(|i| (40 + i * 7, 20 + i * 25)).collect();
        assert!(gpu.set_curve(&sysfs, &good).is_ok());
        assert_eq!(gpu.curve(&sysfs).as_deref(), Some(good.as_slice()));
        assert_eq!(tree.read("class/hwmon/hwmon10/pwm2_enable"), "1");

        let mut falling = good.clone();
        falling[3].1 = 0;
        assert!(gpu.set_curve(&sysfs, &falling).is_err());
        let mut flat = good.clone();
        flat[4].0 = flat[3].0;
        assert!(gpu.set_curve(&sysfs, &flat).is_err());
        assert!(gpu.set_curve(&sysfs, &good[..7]).is_err());

        assert!(gpu.reset_curve(&sysfs).is_ok());
        assert_eq!(tree.read("class/hwmon/hwmon10/pwm2_enable"), "3");
    }
}
