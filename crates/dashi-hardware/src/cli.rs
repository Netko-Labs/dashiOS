//! The command line (docs/hardware.md, "The CLI"): `describe`, `get`, `set`,
//! `co`, `fan-curve`, `boot-guard`, and the `serve`/boot/clean subcommands.
//! `--sysfs-root DIR` points every read and write at a fake tree.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use crate::machine::Machine;
use crate::model::INSTALLED_MODELS;
use crate::slash::{Change, Input};
use crate::sysfs::Sysfs;

pub(crate) struct Args {
    pub(crate) sysfs_root: Option<PathBuf>,
    pub(crate) models_dir: Option<PathBuf>,
    pub(crate) command: Vec<String>,
}

pub(crate) fn parse(mut raw: impl Iterator<Item = String>) -> Result<Args, String> {
    let _program = raw.next();
    let mut sysfs_root = None;
    let mut models_dir = None;
    let mut command = Vec::new();
    while let Some(arg) = raw.next() {
        match arg.as_str() {
            "--sysfs-root" => {
                sysfs_root = Some(PathBuf::from(
                    raw.next().ok_or("--sysfs-root needs a directory")?,
                ));
            }
            "--models" => {
                models_dir = Some(PathBuf::from(
                    raw.next().ok_or("--models needs a directory")?,
                ));
            }
            "--help" | "-h" => return Err(usage()),
            _ => {
                command.push(arg);
                command.extend(raw.by_ref());
            }
        }
    }
    Ok(Args {
        sysfs_root,
        models_dir,
        command,
    })
}

fn usage() -> String {
    "dashi-hardware [--sysfs-root DIR] [--models DIR] \
     <describe | get KNOB | set KNOB VALUE | co [--per-core a,b,…] VALUE | \
     fan-curve FAN [POINTS] | slash [set KEY=VALUE… | restore] | boot-guard | serve | boot | clean>"
        .to_owned()
}

impl Args {
    pub(crate) fn sysfs(&self) -> Sysfs {
        match &self.sysfs_root {
            Some(root) => Sysfs::fake(root),
            None => Sysfs::real(),
        }
    }

    pub(crate) fn models_dir(&self) -> PathBuf {
        if let Some(dir) = &self.models_dir {
            return dir.clone();
        }
        // Beside a fake tree, prefer the repo's data/models for tests.
        if let Some(root) = &self.sysfs_root {
            let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/models");
            if repo.is_dir() {
                return repo;
            }
            return root.join("models");
        }
        PathBuf::from(INSTALLED_MODELS)
    }
}

/// Run a CLI subcommand (not `serve`, which the service module owns).
pub(crate) fn run(args: &Args) -> ExitCode {
    let sysfs = args.sysfs();
    let machine = Machine::open(sysfs, &args.models_dir());
    let command: Vec<&str> = args.command.iter().map(String::as_str).collect();
    match command.as_slice() {
        ["describe"] => print_json(&machine.describe()),
        ["get", knob] => match machine.get(knob) {
            Ok(value) => {
                println!("{value}");
                ExitCode::SUCCESS
            }
            Err(e) => fail(e),
        },
        ["set", knob, value] => match machine.set_text(knob, value) {
            Ok(applied) => {
                println!("{applied}");
                ExitCode::SUCCESS
            }
            Err(e) => fail(e),
        },
        ["co", rest @ ..] => co(&machine, rest),
        ["fan-curve", fan] => match machine.fan_curve(fan) {
            Ok(points) => {
                println!("{}", format_points(&points));
                ExitCode::SUCCESS
            }
            Err(e) => fail(e),
        },
        ["fan-curve", fan, points] => match parse_points(points) {
            Ok(parsed) => match machine.set_fan_curve(fan, &parsed) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => fail(e),
            },
            Err(e) => {
                eprintln!("dashi-hardware: {e}");
                ExitCode::from(2)
            }
        },
        ["slash"] => print_json(&machine.slash_json()),
        ["slash", "set", pairs @ ..] if !pairs.is_empty() => slash_set(&machine, pairs),
        ["slash", "restore"] => {
            print_json(&serde_json::json!({"restored": machine.restore_slash()}))
        }
        ["boot-guard"] => print_json(&machine.boot_guard()),
        ["curve-optimizer"] => {
            print_json(&machine.curve_optimizer_json(&machine.state().saved_tuning()))
        }
        ["apply-saved"] => print_json(&machine.apply_saved_tuning()),
        ["boot"] => boot_guard_step(&machine, true),
        ["clean"] => boot_guard_step(&machine, false),
        _ => {
            eprintln!("dashi-hardware: {}", usage());
            ExitCode::from(2)
        }
    }
}

fn co(machine: &Machine, rest: &[&str]) -> ExitCode {
    let (per_core, value) = match rest {
        ["--per-core", list, value] => (Some(*list), *value),
        [value] => (None, *value),
        _ => {
            eprintln!("dashi-hardware: co [--per-core a,b,…] VALUE");
            return ExitCode::from(2);
        }
    };
    let result = match per_core {
        Some(list) => {
            let offsets: Result<Vec<i32>, _> = list.split(',').map(str::parse::<i32>).collect();
            match offsets {
                Ok(offsets) => {
                    let pairs: Vec<(u32, i32)> = offsets
                        .into_iter()
                        .enumerate()
                        .map(|(core, offset)| (core as u32, offset))
                        .collect();
                    machine.apply_curve_optimizer(0, &pairs)
                }
                Err(_) => {
                    eprintln!("dashi-hardware: --per-core wants a comma-separated list of offsets");
                    return ExitCode::from(2);
                }
            }
        }
        None => match value.parse::<i32>() {
            Ok(offset) => machine.apply_curve_optimizer(offset, &[]),
            Err(_) => {
                eprintln!("dashi-hardware: VALUE is a whole-number offset");
                return ExitCode::from(2);
            }
        },
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => fail(e),
    }
}

/// `slash set enabled=on mode=flow brightness=200 …`
fn slash_set(machine: &Machine, pairs: &[&str]) -> ExitCode {
    let mut change = Change::default();
    for pair in pairs {
        let parsed = pair
            .split_once('=')
            .ok_or_else(|| format!("{pair}: want KEY=VALUE"))
            .and_then(|(key, value)| change.put(key, Input::from_text(value)));
        if let Err(e) = parsed {
            eprintln!("dashi-hardware: {e}");
            return ExitCode::from(2);
        }
    }
    match machine.set_slash(&change) {
        Ok(json) => print_json(&json),
        Err(e) => fail(e),
    }
}

fn boot_guard_step(machine: &Machine, boot: bool) -> ExitCode {
    let result = if boot {
        machine.state().on_boot().map(|guard| {
            print_json(&serde_json::json!({
                "cleanBoot": guard.clean_boot,
                "failedBoots": guard.failed_boots,
                "reset": guard.reset,
            }));
        })
    } else {
        machine.state().on_clean()
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("dashi-hardware: {e}");
            ExitCode::FAILURE
        }
    }
}

fn print_json(value: &serde_json::Value) -> ExitCode {
    match serde_json::to_string_pretty(value) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("dashi-hardware: {e}");
            ExitCode::FAILURE
        }
    }
}

fn fail(e: crate::machine::OpError) -> ExitCode {
    eprintln!("dashi-hardware: {e}");
    ExitCode::FAILURE
}

/// Points as `temp:pwm,temp:pwm,…`, both 0–255.
pub(crate) fn parse_points(text: &str) -> Result<Vec<(u8, u8)>, String> {
    text.split(',')
        .map(|pair| {
            let (temp, pwm) = pair
                .split_once(':')
                .ok_or_else(|| format!("{pair}: want temp:pwm"))?;
            Ok((
                temp.parse()
                    .map_err(|_| format!("{temp}: not a number 0–255"))?,
                pwm.parse()
                    .map_err(|_| format!("{pwm}: not a number 0–255"))?,
            ))
        })
        .collect()
}

pub(crate) fn format_points(points: &[(u8, u8)]) -> String {
    points
        .iter()
        .map(|(t, p)| format!("{t}:{p}"))
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_and_the_command_split() {
        let args = parse(
            ["prog", "--sysfs-root", "/tmp/x", "set", "ppt-spl", "45"]
                .into_iter()
                .map(String::from),
        )
        .expect("parses");
        assert_eq!(args.sysfs_root, Some(PathBuf::from("/tmp/x")));
        assert_eq!(args.command, vec!["set", "ppt-spl", "45"]);
    }

    #[test]
    fn points_round_trip() {
        let points = parse_points("45:12,62:22").expect("parses");
        assert_eq!(points, vec![(45, 12), (62, 22)]);
        assert_eq!(format_points(&points), "45:12,62:22");
        assert!(parse_points("45-12").is_err());
    }
}
