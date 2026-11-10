#!/usr/bin/env bun
/**
 * dashi-settings-preview: System Settings in a window of its own, opened at
 * one pane, on stand-ins where the machine has nothing to show. For review
 * in the VM, which has no battery: `DASHI_POWER_SUPPLY` points the battery
 * at a fixture directory (system/battery.ts), `XDG_STATE_HOME` the battery
 * monitor at a fixture history (battery/lib/file.ts), and `DASHI_HARDWARE_BUS=
 * session` the laptop at a fake dashi-hardware (`dashi-hardware --sysfs-root
 * data/fixtures/ga403wr serve`). Writes to the hardware and the power
 * profiles stay in memory (system/stand-in.ts); the settings are a file of
 * the preview's own. Not part of the session: run it by hand, in the
 * session's environment.
 *
 *   dashi-settings-preview [pane] [--dark]
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAppearanceSource } from "@dashi/ui";
import { SETTINGS_APP_ID } from "../src/apps.ts";
import { startBatteryMonitor } from "../src/battery/start.ts";
import type { GraphicsController, GraphicsSnapshot } from "../src/graphics/controller.ts";
import { hardwareClient, shadowHardware } from "../src/hardware/client.ts";
import type { Laptop } from "../src/laptop/start.ts";
import { LaptopStore } from "../src/laptop/store.ts";
import { openOverlay } from "../src/overlay.tsx";
import { parseRecipes } from "../src/power/modes/recipes.ts";
import { ModeStore } from "../src/power/modes/store.ts";
import { fakeLid } from "../src/power/policy.ts";
import type { PaneContext } from "../src/settings-app/context.ts";
import type { PaneServices } from "../src/settings-app/services.ts";
import { RowFocus } from "../src/settings-app/spot.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { SETTINGS_WINDOW, SettingsWindow } from "../src/settings-app/view.tsx";
import { FlagsStore } from "../src/shared/control-center/flags.ts";
import { isPaneId, Nav } from "../src/shared/settings/panes.ts";
import { readBatteryDetails } from "../src/system/battery-details.ts";
import { EnergyStore } from "../src/system/energy.ts";
import { powerProfiles, shadowProfiles } from "../src/system/profiles.ts";
import { hardwareBus, systemBus } from "../src/system/system-bus.ts";

const args = process.argv.slice(2);
const pane = args.find((arg) => !arg.startsWith("--")) ?? "battery";
if (!isPaneId(pane)) {
  console.error(`dashi-settings-preview: no pane "${pane}"`);
  process.exit(2);
}

const settings = new SettingsStore(join(mkdtempSync(join(tmpdir(), "dashi-settings-preview-")), "settings.json"));
// A charge limit, so the gauge has its tick and the line its dashed limit.
settings.patch("power", { chargeLimit: 80 });
const flags = new FlagsStore(null);
flags.set({ dark: args.includes("--dark") });
setAppearanceSource({ subscribe: flags.subscribe, isDark: () => flags.getSnapshot().dark });

// The laptop: the power modes and the charge limit from dashi-hardware, writes kept in memory.
const hardware = shadowHardware(hardwareClient(hardwareBus()));
const profiles = shadowProfiles(powerProfiles(systemBus()));
const store = new LaptopStore(hardware);
const modes = new ModeStore({
  profiles,
  hardware,
  settings: () => settings.getSnapshot().data.power,
  saveChoice: (choice) => settings.patch("power", { mode: choice === "automatic" ? undefined : choice }),
});
void hardware
  .describe()
  .catch(() => null)
  .then((machine) => {
    // The fixture is a laptop whatever the VM's chassis says.
    store.setMachine(machine ? { ...machine, laptop: true } : null, true);
    modes.setMachine(machine ? { knobs: machine.knobs, recipes: parseRecipes(machine.recipes) } : null);
  });
void profiles.read().then((read) => modes.setProfiles(read?.available ?? null, read?.active ?? null));
/** The parts of `T` this preview uses; another pane may find the rest missing. */
const stub = <T extends object>(parts: Partial<T>): T => parts as T;
const NO_CARD = stub<GraphicsSnapshot>({ hasCard: false, switchable: false, lost: null, choice: "automatic" });
const graphics = stub<GraphicsController>({ subscribe: () => () => {}, getSnapshot: () => NO_CARD });
const laptop: Laptop = { store, modes, graphics, run() {}, setLight: (level) => void store.set("kbd-backlight", level), close() {} };

const battery = startBatteryMonitor({ compositor: null, apps: [] });
battery.subscribe(() => {
  const now = battery.getSnapshot().battery;
  if (now) modes.setPowerSource({ plugged: now.state !== "discharging", percent: now.percent });
});
const energy = new EnergyStore({ battery: () => readBatteryDetails(), profiles, lid: fakeLid() });

// Only what the panes shown here read; another pane may find a service missing.
const services = stub<PaneServices>({ battery, laptop, refresh: null, energy });
const nav = new Nav();
nav.select(pane);
const ctx = stub<PaneContext>({
  settings,
  flags,
  services,
  show: (to: string) => isPaneId(to) && nav.select(to),
  home: process.env.HOME ?? "",
});

const focus = new RowFocus();
let handle: ReturnType<typeof openOverlay> | null = null;
handle = openOverlay(
  { title: "System Settings", appId: `${SETTINGS_APP_ID}-preview`, width: SETTINGS_WINDOW.width, height: SETTINGS_WINDOW.height, titleBar: "unified" },
  <SettingsWindow ctx={ctx} nav={nav} spots={{ focus, scroll: (testID, dy) => handle?.scroll?.(testID, dy) }} />,
  () => {
    battery.stop();
    process.exit(0);
  },
);
