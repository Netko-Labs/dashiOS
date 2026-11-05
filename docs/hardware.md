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
  "modelName": "ROG Zephyrus G14 (2025)",  // the database entry's name, or null
  "vendor": "ASUSTeK COMPUTER INC.",
  "product": "ROG Zephyrus G14 GA403WR_GA403WR",
  "laptop": true,                 // DMI chassis type, and a battery present
  "knobs": {
    "platform-profile": {"value": "balanced", "choices": ["low-power", "balanced", "performance"]},
    "charge-limit": {"value": 100, "min": 20, "max": 100, "unit": "%"},
    "ppt-spl": {"value": 80, "min": 15, "max": 80, "unit": "W"},
    "gpu-mux": {"value": 1, "min": 0, "max": 1, "pendingReboot": false}
  },
  "fans": [{"id": "cpu", "label": "CPU fan", "rpm": 2300, "curve": true}],
  "lighting": {"keyboard": {"levels": 3, "rgb": false}, "slash": true, "aura": false, "anime": false},
  "hotkeys": {"mode": "KEY_PROG3", "lighting": "KEY_KBDILLUMTOGGLE", "rog": "KEY_PROG1", "micMute": "KEY_MICMUTE"},
  "quirks": ["d3cold-drops"],
  "recipes": { /* the model's mode recipes, see below, or null for tuned's defaults */ }
}
```

`modelName` is the database entry's display name (`null` with no match).
Each knob carries `value` plus its range (`min`/`max`, and `unit` when it has
one) or `choices`; `gpu-mux` adds `pendingReboot` (it applies at the next
boot). `lighting.keyboard` is the number of brightness steps (`levels`, from
the model, else the kernel's `max_brightness`) and whether it's RGB;
`slash`, `aura` and `anime` say whether each USB light is present.

## The model database

One JSON file per model in `data/models/`, matched on DMI
(`sys_vendor`, `product_name`, `board_name` or `product_family`, exact or a
`*`-suffixed prefix; `match` may be a list, matching if any entry does). What
the kernel reports always wins: the file can narrow a range and name things,
not invent a knob. It is a JSON Schema (`data/models/schema.json`), installed
to `/usr/share/dashi/models/`. Beyond the fields below it may carry `fans`
(fan id → label) and `limits` (knob → `[min, max]`, narrowing the kernel's
range). Example:

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

## cardwire

Graphics switching is cardwire's (Open Gaming Collective,
<https://github.com/OpenGamingCollective/cardwire>, GPL-3.0), packaged as
`dashi-graphics` (`spin/rpm/dashi-graphics.spec`). It is not part of
dashi-hardware: the shell (`src/graphics/`) talks to it directly. Read from
upstream's source on 2026-11-05: the main branch (0.13.0-alpha.1, commit
`0b3f2e5`) and the tag `v0.12.3`, the version Terra ships for Fedora 44. The
introspection XML (`org.opengamingcollective.cardwire.xml`) is the same in
both; the one difference a client sees is `GetDevice`'s struct (below).
Upstream calls it early ("expect breaking changes"): parse every reply
defensively and treat a missing name as "no cardwire".

How it works: an eBPF LSM program returns `ENOENT` for opens of a blocked
card's nodes (`/dev/dri/cardN`, `/dev/dri/renderDN`, `/dev/nvidiaN`, its PCI
`config`), so the card stays bound and can reach D3cold, and nothing needs a
logout. A block applies to opens after it: an app already holding the card
keeps it. It needs `bpf` among the active LSMs (`/sys/kernel/security/lsm`);
the daemon refuses to start without it.

| | |
| --- | --- |
| Bus | system |
| Name | `org.opengamingcollective.cardwire` (also `net.hadess.SwitcherooControl`, a switcheroo-control shim, when it can take the name) |
| Daemon | `cardwired`, unit `cardwired.service` (`Type=dbus`, root) |
| Root object | `/org/opengamingcollective/cardwire`, with `org.freedesktop.DBus.ObjectManager` |
| GPU objects | `/org/opengamingcollective/cardwire/Gpu/<id>` (`id` 0, 1, … as cardwire numbers them) |
| Config, state | `/etc/cardwire/cardwire.toml`, `/var/lib/cardwire/` |
| Access | the bus policy lets any local user call everything; there is no polkit check |

### Modes

`u` everywhere: `0` Integrated, `1` Hybrid, `2` Manual, `3` Smart.

- **Integrated**: the offload card (discrete and not the default) is blocked
  for every process.
- **Hybrid**: nothing is blocked.
- **Smart**: blocked by default; a process is let through when its
  environment asks (`CARDWIRE_ALLOW=1`, `CARDWIRE_FORCE_DGPU=1`,
  `CARDWIRE_FORCE_GPU=<id>`, checked at exec), when its app's stored policy
  allows it (matched on the process name, or Steam's `SteamAppId`), or when
  `RequestProcessAccess` grants its PID.
- **Manual**: per-GPU `Block`; only on machines cardwire classes as desktops.

Laptops (an offload discrete card) get Integrated, Hybrid and Smart;
`AvailableModes` says which. Setting Integrated or Smart elsewhere fails with
`org.freedesktop.DBus.Error.NotSupported`. On Hybrid and Manual it starts
`nvidia-powerd`; on Integrated and Smart it stops it.

### Root object interfaces

| Interface | Member | Signature | Notes |
| --- | --- | --- | --- |
| `…cardwire.Mode` | property `Mode` | `u`, read-write | The applied mode. Setting it switches and saves. `PropertiesChanged` is emitted on every change, automatic ones included. |
| | `AvailableModes()` | → `au` | `[0, 1, 3]` on a laptop, `[1, 2]` otherwise. |
| `…cardwire.Config` | properties `AutoApplyGpuState` `b`, `BatteryAutoSwitch` `b`, `BatteryAutoSwitchMode` `u`, `ExperimentalNvidiaBlock` `b`, `ExternalDisplayAutoSwitch` `b` | read-write | Each setter saves `cardwire.toml`. `SaveToFile()` saves too. |
| `…cardwire.SmartPolicy` | `RequestProcessAccess(u pid, s policy, u value)` | | `policy`: `Default` (nothing), `Allow_dGPU` (`value` ignored), `Force_dGPU` (`value` 1: the iGPU is hidden from it), `Force_GPU` (`value`: a GPU id). Fails when the PID doesn't exist. Lasts until the process exits. |
| | `GetProcessStatus(u pid)` | → `s status`, `au gpu` | `status` `Allowed`, `Forced` or empty; `gpu` empty or one id. |
| | `GetAppPolicies()` | → `a{s(sasasu)}` | app key (lower-case process name) → (display name, desktop file id as a 0–1 element array, icon name as a 0–1 element array, policy). Policy `0` Blocked, `1` Allowed, `2` Forced. |
| | `SetAppPolicy(s app, i policy)` | | `policy` 0–2, persistent (cardwire's SQLite database). |
| | signal `NewAppAdded` | `(s(sasasu))` | An app found in the XDG desktop entries the first time it runs, added as Blocked. |
| `…cardwire.Logger` | `ProcessBlocked()` | → `a((tu)usus)` | Recent opens cardwire refused: ((seconds, nanoseconds) since the epoch, PID, process name, GPU id, Wayland app id). |
| | signal `ProcessBlockedChanged` | `((tu)usus)` | One such entry, as it happens. |
| `…cardwire.Debug` | `GetPciDevices()` | → `a{s(sssssssss)}` | PCI address → (IOMMU group, vendor id, device id, vendor name, device name, driver, class, parent PCI, child PCI). |
| | `RefreshGpu()` | | Re-scans PCI; rebuilds the GPU objects when they changed. |
| `…cardwire.Manager` | `Status()` | | Returns nothing; a liveness check. |

### GPU objects

Interface `org.opengamingcollective.cardwire.Gpu`:

| Member | Signature | Notes |
| --- | --- | --- |
| `GetDevice()` | 0.12.3: → `(ssuubbbbssbs)`; main: → `(ssuubussa{sv})` | 0.12.3: name, PCI address, render minor (`renderD<n>`), card minor (`card<n>`), default, discrete, virtual, available, vendor, driver, NVIDIA, NVIDIA minor (a string). main: name, PCI address, render, card, default, type (`0` integrated, `1` discrete, `2` virtual, `3` other, `4` unavailable, `5` unknown, `6` external), vendor, driver, extra properties (`NvidiaMinor`). Read it by its signature. |
| property `Block` | `b`, read-write | Whether every node of the card is blocked. Setting it works only in Manual mode (`AccessDenied` otherwise), never on the default GPU or one driving a screen. |
| property `Env` | `as`, read | The environment that routes an app to this card, as a flat list of name, value, name, value (`CARDWIRE_FORCE_DGPU 1 __NV_PRIME_RENDER_OFFLOAD 1 __GLX_VENDOR_LIBRARY_NAME nvidia …`, or `DRI_PRIME pci-…` for AMD and Intel). |
| property `Launchable` | `b`, read | Whether an offload launch on it can work now: available and not blocked, or blocked in Smart mode (where the policy can grant access). |
| `PowerState()` | → `s` | The card's `/sys/bus/pci/devices/<pci>/power_state`, with its newline: `D0`, `D3hot`, `D3cold`. |
| signal `PowerStateChanged` | `s` | Polled every 500 ms, sent on change. |
| `Lsof()` | → `a{sas}` | Device node path → the **process names** (`/proc/<pid>/comm`) holding it open: `/dev/dri/card<n>`, `/dev/dri/renderD<n>`, and on NVIDIA `/dev/nvidia<n>` and `/dev/nvidiactl`. Names only, no PIDs, deduplicated per node only when adjacent. |

### Listing what uses the card

`Lsof` gives names, not PIDs, and the shell needs PIDs to quit an app and to
match windows, so the holders list is the shell's own scan of
`/proc/*/fd/*` for links to the card's nodes (the paths `GetDevice` gives:
`/dev/dri/card<card>`, `/dev/dri/renderD<render>`, `/dev/nvidia<minor>`). As
the person, it sees only their own processes, which are the ones it can quit;
`Lsof` (run as root) can name the rest ("and 2 system processes").

### What cardwire decides on its own

`BatteryAutoSwitch` switches modes on UPower's `OnBattery` (to the configured
modes for battery and AC), and `ExternalDisplayAutoSwitch` goes to Hybrid
while a screen is connected to the blocked card. Both are Dashi's policy
(`src/graphics/`), and both are off by default (0.12.3's flat
`cardwire.toml` and main's nested one, which migrates the flat keys, agree).
`dashi-graphics` ships no `cardwire.toml` (cardwired writes that file
itself); the shell sets the two properties to `false` when it finds them on,
and sets `Mode` itself.
