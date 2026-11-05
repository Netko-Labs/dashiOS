# dashi-hardware

`dashi-hardware` is Dashi's one privileged helper for what a laptop's kernel
exposes: firmware attributes, platform profiles, the charge limit, fan curves,
the keyboard light, cpufreq boost and EPP, the graphics card's firmware
limits, and AMD's SMU mailbox (the Curve Optimizer). It is a Rust system
service (`crates/dashi-hardware`), D-Bus activated on the **system** bus, with
a polkit action per kind of change. The shell, Settings and applets (ASUS
Control) call it; nothing else in Dashi writes these files.

It decides nothing: which mode applies when is the shell's (`src/power/`).
It enforces ranges: every value is clamped to what the kernel reports and the
model database allows for this machine, whatever the caller asked.

This file is the contract. The service and its callers change with it.

## Names

| | |
| --- | --- |
| Bus | system |
| Name | `dev.dashi.Hardware1` |
| Object | `/dev/dashi/Hardware1` |
| Interface | `dev.dashi.Hardware1` |
| Binary | `/usr/libexec/dashi/dashi-hardware` (`serve` for the service, other subcommands for the CLI) |
| Unit | `dashi-hardware.service` (system), `Type=dbus`, D-Bus activated |
| State | `/var/lib/dashi-hardware/` (saved tuning, the boot guard) |
| Model database | `/usr/share/dashi/models/*.json` (source: `data/models/`) |

## Knobs

A knob is a named setting with a type. `Describe()` lists the ones this
machine has, with their ranges; a knob the machine lacks is absent, never
reported as zero.

| Knob | Type | Range from | Polkit action |
| --- | --- | --- | --- |
| `platform-profile` | `s` (`low-power`, `balanced`, `performance`) | `platform_profile_choices`; every profile handler (asus-wmi's `quiet` is `low-power`) | `dev.dashi.hardware.everyday` |
| `charge-limit` | `u` percent | `charge_control_end_threshold` (BAT*) | everyday |
| `kbd-backlight` | `u` level | `/sys/class/leds/*::kbd_backlight/max_brightness` | everyday |
| `panel-overdrive` | `b` | firmware attribute `panel_overdrive` | everyday |
| `boost` | `b` | `/sys/devices/system/cpu/cpufreq/boost` | everyday |
| `epp` | `s` | `energy_performance_available_preferences` | everyday |
| `cpu-max-freq` | `u` kHz (0 = no cap) | `cpuinfo_min_freq`..`cpuinfo_max_freq` | everyday |
| `ppt-spl`, `ppt-sppt`, `ppt-fppt` | `u` watts | firmware attributes `ppt_pl1_spl`, `ppt_pl2_sppt`, `ppt_pl3_fppt` (`min_value`, `max_value`) | `dev.dashi.hardware.tune` |
| `nv-tgp`, `nv-dynamic-boost`, `nv-temp-target` | `u` | firmware attributes `nv_tgp`, `nv_dynamic_boost`, `nv_temp_target` | tune |
| `gpu-mux` | `u` (0 dGPU only, 1 hybrid) | firmware attribute `gpu_mux_mode`; applies at the next boot | tune |

Fan curves and the Curve Optimizer have their own methods (below), under the
`tune` action. `everyday` is `allow_active=yes`; `tune` is
`auth_admin_keep`.

## Methods

| Method | In | Out | Notes |
| --- | --- | --- | --- |
| `Describe` | | `s` JSON | The machine (below). Cheap; callers may cache it until `Changed` with knob `""`. |
| `Get` | `s knob` | `v` | |
| `Set` | `s knob`, `v value` | `v applied` | Clamped; returns what was written. |
| `SetMany` | `a{sv}` | `a{sv}` | One recipe in one call; each knob is written once, in a fixed order (profile first). |
| `GetFanCurve` | `s fan` | `a(yy)` | Points (°C, PWM 0–255), 8 per fan on ASUS. |
| `SetFanCurve` | `s fan`, `a(yy)` | | Validated: temperatures rising, PWM not falling. `tune`. |
| `ResetFanCurves` | | | Back to the firmware's curves. `tune`. |
| `CurveOptimizer` | | `s` JSON | `{"available": bool, "reason": s, "range": [min, max], "perCore": bool, "cores": u, "allCore": i, "perCoreValues": [i]}`; `reason` when unavailable: `unsupported-cpu`, `lockdown`, `rejected`, `not-in-database`. |
| `SetCurveOptimizer` | `i allCore`, `ai perCore` (empty for all-core only), `u confirmWithin` (s) | `s token` | `tune`. Applied now; reverted to 0 unless `ConfirmTuning(token)` arrives within `confirmWithin` (0 means no countdown, only for re-applying saved values). |
| `ConfirmTuning` | `s token` | | Keeps the values; saves them for the boot guard. |
| `ApplySavedTuning` | | `s` JSON | Called by the shell at login and after waking. Applies saved tuning (power limits, the Curve Optimizer, GPU limits) only after a clean boot; returns `{"applied": bool, "reason": s}`. |
| `ClearSavedTuning` | | | `tune`. |
| `BootGuard` | | `s` JSON | `{"cleanBoot": bool, "failedBoots": u, "reset": bool}`; `reset` when two failed boots in a row cleared the saved tuning. |

## Signals

| Signal | Args | When |
| --- | --- | --- |
| `Changed` | `s knob`, `v value` | A knob changed, by Dashi or anything else (Fn F5 changes `platform-profile`: the service watches the sysfs files with `poll`). `""` and an empty value mean "describe again". |

## Describe

```json
{
  "model": "GA403WR",            // the database entry matched, or null
  "vendor": "ASUSTeK COMPUTER INC.",
  "product": "ROG Zephyrus G14 GA403WR_GA403WR",
  "laptop": true,                 // DMI chassis type, and a battery present
  "knobs": {
    "platform-profile": {"value": "balanced", "choices": ["low-power", "balanced", "performance"]},
    "charge-limit": {"value": 100, "min": 20, "max": 100},
    "ppt-spl": {"value": 80, "min": 15, "max": 80, "unit": "W"}
  },
  "fans": [{"id": "cpu", "label": "CPU fan", "rpm": 2300, "curve": true}],
  "lighting": {"keyboard": {"levels": 3}, "slash": true, "aura": false},
  "hotkeys": {"mode": "KEY_PROG3", "lighting": "KEY_KBDILLUMTOGGLE", "rog": "KEY_PROG1", "micMute": "KEY_MICMUTE"},
  "quirks": ["d3cold-drops"],
  "recipes": { /* the model's mode recipes, see below, or null for tuned's defaults */ }
}
```

## The model database

One JSON file per model in `data/models/`, matched on DMI
(`sys_vendor` and `product_name` or `board_name`, exact or a prefix). What the
kernel reports always wins: the file can narrow a range and name things, not
invent a knob. Schema (`data/models/schema.json`):

```json
{
  "id": "GA403WR",
  "match": {"sys_vendor": "ASUSTeK COMPUTER INC.", "board_name": "GA403WR"},
  "name": "ROG Zephyrus G14 (2025)",
  "undervolt": {"cpu": [-40, 0], "perCore": true, "graphics": false},
  "hotkeys": {"mode": "KEY_PROG3", "lighting": "KEY_KBDILLUMTOGGLE", "rog": "KEY_PROG1", "micMute": "KEY_MICMUTE"},
  "lighting": {"slash": {"usb": "0b05:19b6"}, "keyboard": {"levels": 3}},
  "quirks": ["d3cold-drops"],
  "recipes": {
    "low-power":   {"plugged": {"platform-profile": "low-power", "epp": "power", "ppt-spl": 30}, "battery": {"platform-profile": "low-power", "epp": "power", "ppt-spl": 15, "boost": false}},
    "balanced":    {"plugged": {"platform-profile": "balanced", "epp": "balance_performance", "ppt-spl": 55}, "battery": {"platform-profile": "balanced", "epp": "balance_power", "ppt-spl": 30}},
    "performance": {"plugged": {"platform-profile": "performance", "epp": "performance", "ppt-spl": 80}, "battery": {"platform-profile": "balanced", "epp": "balance_performance", "ppt-spl": 45}}
  }
}
```

## The Curve Optimizer

Sent to the SMU's MP1 mailbox through the PCI root complex's SMN index/data
registers (the way RyzenAdj reaches it, without `/dev/mem` or a kernel
module). All-core is message `0x4C`, per-core `0x4B` (core in bits 20+, value
in the low 20 bits). Negative offsets are 20-bit two's complement:
`0x100000 + offset` (−5 is `0xFFFFB`); a plain signed 32-bit value is rejected.
Strix Point has no graphics offset. Available only when the CPU family is
known, kernel lockdown is off (it blocks the PCI writes with Secure Boot on),
the model database gives a range, and a write of 0 is accepted. The SMU
forgets the offset at reboot and sometimes on resume, so the shell calls
`ApplySavedTuning` at login and after waking.

## The boot guard

`dashi-hardware-boot.service` runs early at boot and counts: a boot that
never reaches `dashi-hardware-clean.service` (ordered at shutdown) counts as
failed. Saved tuning is applied only after a clean boot; two failed boots in
a row clear it (`reset: true`, which the shell shows once). Values that can
freeze the machine are applied with a countdown (`confirmWithin`) first, and
saved only once confirmed.

## The CLI

`dashi-hardware describe | get KNOB | set KNOB VALUE | co [--per-core a,b,…] VALUE | fan-curve FAN [POINTS] | boot-guard`,
for testing on real hardware as root. `--sysfs-root DIR` reads and writes a
fake tree instead of `/sys` (tests, the VM: `data/fixtures/ga403wr/` holds the
G14's, captured read-only); with it the SMU is simulated.
