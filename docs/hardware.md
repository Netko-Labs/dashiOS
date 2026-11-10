# dashi-hardware

`dashi-hardware` is Dashi's one privileged helper for what a laptop's kernel
exposes: firmware attributes, platform profiles, the charge limit, fan curves,
the keyboard light, the lid's Slash bar (USB), cpufreq boost and EPP, the
graphics card's firmware limits, and AMD's SMU mailbox (the Curve Optimizer). It is a Rust system
service (`crates/dashi-hardware`), D-Bus activated on the **system** bus, with
a polkit action per kind of change. The shell, Settings and applets (ASUS
Control) call it; nothing else in Dashi writes these files.

It decides nothing: which mode applies when is the shell's (`src/power/`). An
applet that wants Dashi's power mode (Automatic included) asks the shell on
the applets channel (`power.mode`, docs/applets.md "Version 4"); a
`platform-profile` set here is taken as a press of Fn F5.
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
| State | `/var/lib/dashi-hardware/` (saved tuning, the boot guard, the Slash bar's settings) |
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
`tune` action; the Slash bar has its own, under `everyday`. `everyday` is `allow_active=yes`; `tune` is
`auth_admin_keep`.

A `SetMany` whose `tune` knobs all match one of the model's own recipe
columns (`recipes`, below) is a mode switch and needs only `everyday`: those
values ship in the root-owned model database, so switching modes on power or
battery never asks for the password. Any other value of a `tune` knob does.

## Methods

| Method | In | Out | Notes |
| --- | --- | --- | --- |
| `Describe` | | `s` JSON | The machine (below). Cheap; callers may cache it until `Changed` with knob `""`. |
| `Get` | `s knob` | `v` | |
| `Set` | `s knob`, `v value` | `v applied` | Clamped; returns what was written. |
| `SetMany` | `a{sv}` | `a{sv}` | One recipe in one call; each knob is written once, in a fixed order (profile first). `everyday` when its `tune` knobs match a model recipe column. |
| `GetFanCurve` | `s fan` | `a(yy)` | Points (°C, PWM 0–255), 8 per fan on ASUS. |
| `SetFanCurve` | `s fan`, `a(yy)` | | Validated: temperatures rising, PWM not falling. `tune`. |
| `ResetFanCurves` | | | Back to the firmware's curves. `tune`. |
| `CurveOptimizer` | | `s` JSON | `{"available": bool, "reason": s, "range": [min, max], "perCore": bool, "cores": u, "allCore": i, "perCoreValues": [i]}`; `reason` when unavailable: `unsupported-cpu`, `lockdown`, `rejected`, `not-in-database`. |
| `SetCurveOptimizer` | `i allCore`, `ai perCore` (empty for all-core only), `u confirmWithin` (s) | `s token` | `tune`. Applied now; reverted to 0 unless `ConfirmTuning(token)` arrives within `confirmWithin` (0 means no countdown, only for re-applying saved values). |
| `ConfirmTuning` | `s token` | | Keeps the values; saves them for the boot guard. |
| `ApplySavedTuning` | | `s` JSON | Called by the shell at login and after waking. Sends the Slash bar's saved settings again (always), and applies saved tuning (power limits, the Curve Optimizer, GPU limits) only after a clean boot; returns `{"applied": bool, "reason": s, "slash": bool}` (`slash`: whether saved Slash settings were sent). |
| `ClearSavedTuning` | | | `tune`. |
| `BootGuard` | | `s` JSON | `{"cleanBoot": bool, "failedBoots": u, "reset": bool}`; `reset` when two failed boots in a row cleared the saved tuning. |
| `Slash` | | `s` JSON | The lid's Slash bar ("The Slash bar", below). |
| `SetSlash` | `a{sv}` | `s` JSON | Any of the bar's keys; validated and clamped, sent, saved; returns `Slash()`'s JSON. `everyday`. `NotSupported` when the machine has no bar or its device isn't there; `InvalidArgs` for an unknown key, a wrong type or an unknown animation. |

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
`slash` is true when the model names a Slash bar and its device is found;
`aura` and `anime` say whether the model names those USB lights.

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

A recipe column holds knobs only. The built-in screen's refresh rate is not a
recipe's: it follows the power source by itself (Settings › Displays,
Automatic refresh rate; `docs/architecture.md`, "Screens and the power
source"), and a `screen-rate` key an older file still carries is left out,
never sent as a knob.

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

## The Slash bar

The lid's light bar on recent ROG laptops (the G14 2024 and 2025, G16, the
2025 Strix G16) is a USB HID device with no kernel driver of its own; asusd
used to drive it. dashi-hardware drives it itself, over hidraw, with asusd's
protocol, in `crates/dashi-hardware/src/slash/`. asusctl is MPL-2.0, so none
of its code is in Dashi: the packets (`slash/packet.rs`) are implemented clean
room (docs/conventions.md, "Licenses") from `docs/cleanroom/slash-protocol.md`,
a spec of facts only (bytes, lengths, orderings, ranges) written by someone
who read asusctl, by someone who read only that spec. `slash/vectors.rs`
checks every test vector in the spec byte for byte, and `slash/tests.rs` what
each change and restore sends.

- **Found** by the model database's `lighting.slash.usb` (`0b05:19b6` on the
  2025 G14): the hidraw node whose `device/uevent` has
  `HID_ID=0003:<vendor>:<product>` (USB); with several, the one whose report
  descriptor declares the bar's report id. Looked up on every call, since the
  node can change when the device comes back.
- **Written** with `write()` on `/dev/hidrawN`, one packet at a time at the
  length asusd uses (32 bytes zero-padded for init, on/off, the animation and
  "save"; 6, 7, 12 or 13 bytes for the rest). Report id `0x5d`, or `0x5e` for
  the 2024 bar (`0b05:193b`). Nothing is read from it.
- **Remembered**: the bar can't be read back and forgets at boot, so what the
  helper last set is kept in its state file (`slash` in `state.json`) and sent
  again, with asusd's start-up sequence (two init packets, on/off, options,
  the animation, the boot, sleep, shutdown, battery and low-battery flags),
  when the service starts and at every `ApplySavedTuning` (the shell calls it
  at login and after waking). A bar the helper never set is left alone. The
  first `SetSlash` sends every setting (the bar's state is unknown until then);
  later ones send only what changed.

`Slash()` returns:

```json
{
  "available": true, "reason": "", "device": "hidraw5", "saved": true,
  "enabled": true, "mode": "bounce", "brightness": 255, "interval": 0,
  "showOnBoot": true, "showOnShutdown": true, "showOnSleep": true,
  "showOnBattery": true, "showBatteryWarning": true, "showOnLidClosed": true,
  "modes": ["static", "bounce", "slash", "loading", "bit-stream", "transmission", "flow", "flux",
            "phantom", "spectrum", "hazard", "interfacing", "ramp", "game-over", "start", "buzzer"],
  "limits": {"brightness": [0, 255], "interval": [0, 5]}
}
```

or `{"available": false, "reason": "not-in-database" | "no-device"}`. Before
the first `SetSlash` the values are asusd's defaults (`saved: false`).
`SetSlash` takes the same keys (`enabled` `b`, `mode` `s`, `brightness` and
`interval` any integer type, clamped to `limits`, the six `show…` flags
`b`). As in asusd, a `brightness` without `enabled` turns the bar on above 0
and off at 0, and turning it on at brightness 0 turns it on at `0x88`.
`interval` is the pause between plays (0 shortest). The `show…` flags say
when the bar plays: at boot and shutdown, while asleep, on battery, with the
lid closed, and the low-battery warning; whether each holds on a given model
is the firmware's.

## The boot guard

`dashi-hardware-boot.service` runs early at boot and counts: a boot that
never reaches `dashi-hardware-clean.service` (ordered at shutdown) counts as
failed. Saved tuning is applied only after a clean boot; two failed boots in
a row clear it (`reset: true`, which the shell shows once). Values that can
freeze the machine are applied with a countdown (`confirmWithin`) first, and
saved only once confirmed.

## The service's sandbox

`dashi-hardware.service` runs as root, because what it writes is root's, but it
sees little else. `systemd-analyze security` scores it 1.4 (it was 7.5), and
`scripts/check-units.ts` (H17, run by `bun run check` and the tests) fails the build above 5.0. Each
setting, and what it leaves open:

| Setting | Why it is safe here |
| --- | --- |
| `ProtectSystem=strict`, `ProtectKernelTunables=yes`, `ReadWritePaths=/sys/class /sys/devices /sys/firmware/acpi`, `StateDirectory=` | Everything is read-only except those sysfs subtrees (firmware attributes, platform profile, power supply, LEDs, hwmon, cpufreq, the PCI config file the SMU is reached through, and the legacy `firmware/acpi/platform_profile`) and `/var/lib/dashi-hardware`. The rest of `/sys` (`/sys/module`, `/sys/kernel`) and `/proc/sys` are read-only. |
| `DevicePolicy=closed`, `DeviceAllow=char-hidraw rw` | The Slash bar's `/dev/hidrawN`, and no other device. |
| `PrivateNetwork=yes`, `RestrictAddressFamilies=AF_UNIX` | The system bus is a path socket, which a private network still reaches. |
| `NoNewPrivileges`, `CapabilityBoundingSet=CAP_SYS_RAWIO CAP_DAC_OVERRIDE`, `SystemCallFilter=@system-service` less `@privileged @resources`, `MemoryDenyWriteExecute`, `LockPersonality`, `RestrictSUIDSGID`, `SystemCallArchitectures=native` | No other capability, no privileged or resource-limit call, no new executable memory. |
| `ProtectHome`, `PrivateTmp`, `ProtectProc=invisible`, `ProcSubset=pid`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectClock`, `ProtectHostname`, `ProtectControlGroups`, `RestrictNamespaces`, `RestrictRealtime`, `UMask=0077`, `LimitCORE=0` | Nothing it needs. |

Checked in the VM:
the unit starts, takes the bus name and answers `Describe`, `BootGuard`,
`Get` and `Slash` over the system bus; with this sandbox a write to an LED, a
write to a PCI config file and an open of a hidraw node work, a write to
`/sys/module` or `/etc` and an open of a disk do not.

What only the real laptop can settle: the two capabilities. The VM's kernel
runs the same sysfs code, and there those writes work with an empty bounding
set, so neither should be needed (a sysfs attribute is root's, mode 0644).
But the G14's firmware attributes, fan curves and the SMU's PCI config were
not written under this sandbox (the fixtures are read-only and the helper is
never run against the laptop), so they stay until someone tries
`CapabilityBoundingSet=` there and runs `set`, `fan-curve` and `co` once each.
Dropping both takes the score to 1.0.

`dashi-hardware-boot.service` and `-clean.service` read sysfs and write the
state file, so they have no capabilities, no devices, and a read-only `/sys`
(0.9 each).

## The CLI

`dashi-hardware describe | get KNOB | set KNOB VALUE | co [--per-core a,b,…] VALUE | fan-curve FAN [POINTS] | slash [set KEY=VALUE… | restore] | boot-guard`,
for testing on real hardware as root (`slash set mode=flow brightness=200
showOnSleep=off`; `slash restore` sends the saved settings again). `--sysfs-root DIR` reads and writes a
fake tree instead of `/sys` (tests, the VM: `data/fixtures/ga403wr/` holds the
G14's, captured read-only); with it the SMU is simulated, and the Slash bar's
packets are written, one hex line each, to `DIR/.dashi-hardware/slash-hidrawN.log`.

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
dashi-comp is never listed: it holds the card only while a screen is
connected to it, a client's buffer only the card can read is on screen, or
the shell keeps it (`gpu-keep`, `docs/compositor-ipc.md`), and quitting it
would end the session.

### What cardwire decides on its own

`BatteryAutoSwitch` switches modes on UPower's `OnBattery` (to the configured
modes for battery and AC), and `ExternalDisplayAutoSwitch` goes to Hybrid
while a screen is connected to the blocked card. Both are Dashi's policy
(`src/graphics/`), and both are off by default (0.12.3's flat
`cardwire.toml` and main's nested one, which migrates the flat keys, agree).
`dashi-graphics` ships no `cardwire.toml` (cardwired writes that file
itself); the shell sets the two properties to `false` when it finds them on,
and sets `Mode` itself.

## asusd

ASUS's USB lights other than the Slash bar have no kernel driver either:
AniMe Matrix and Aura RGB are asusd's (asusctl, Open Gaming Collective,
<https://github.com/OpenGamingCollective/asusctl>). The Slash bar is
dashi-hardware's now ("The Slash bar", above), and everything else the G14
has is a kernel interface dashi-hardware drives, so **the G14 needs no
asusd**, and ASUS Control doesn't use it. On a model with AniMe or Aura RGB,
asusd may be installed for those lights only, configured to leave the
platform profile, EPP and the charge limit to Dashi's recipe (one writer per
knob); it would also drive a Slash bar at its start-up, so the two shouldn't
both run on a machine with one. Read from asusctl 6.5.0 (Terra's Fedora
build) and upstream's source on 2026-11-05.

Packaging: Terra (enabled by dashi-release) carries `asusctl`, so Dashi's
COPR need not. Dashi doesn't install it.

| | |
| --- | --- |
| Bus | system |
| Name | `xyz.ljones.Asusd` |
| Daemon | `asusd`, unit `asusd.service` |
| Config | `/etc/asusd/asusd.ron` (and `aura.ron`, `fan_curves.ron`) |

### Keeping asusd off Dashi's knobs

In `/etc/asusd/asusd.ron`:

- `change_platform_profile_on_ac: false` and
  `change_platform_profile_on_battery: false` — asusd won't set a platform
  profile when the cable changes (Dashi's Automatic does).
- `platform_profile_linked_epp: false` — asusd won't write EPP with the
  profile (the recipe owns EPP).
- The charge limit is the open question (spec, milestone 2): asusd stores a
  `charge_control_end_threshold` and re-applies it at start-up, and there is
  no config flag to disable that alone. Set asusd's stored value to `100` (no
  limit) so it writes nothing meaningful, and let Dashi's boot unit write the
  real limit after; or, if that races, don't enable `asusd.service`'s
  charge restoration path. Dashi owns `charge-limit` either way.

asusd must not own fan curves either: Dashi writes `asus_custom_fan_curve`
through the kernel (above). Leave asusd's `fan_curves.ron` at its defaults and
don't drive its fan interface.

### Keyboard and Aura lighting

Interface `xyz.ljones.Aura` at `/xyz/ljones/Aura`. `Brightness` (read-write),
`LedMode` and `LedModeData` (the effect), `LedPower` (per-zone power), and the
read-only `DeviceType`, `SupportedBrightness`, `SupportedBasicModes`,
`SupportedBasicZones`, `SupportedPowerZones`; `AllModeData()` returns every
mode's effect, `DirectAddressingRaw(packets)` writes raw per-key colour. The
G14's own keyboard backlight (white, 3 levels) is a kernel LED
(`kbd-backlight` above); Aura is for RGB and per-key models. AniMe Matrix is a
third interface (`xyz.ljones.Anime`), absent on the G14.
