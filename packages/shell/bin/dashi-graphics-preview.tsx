#!/usr/bin/env bun
/**
 * dashi-graphics-preview: the graphics notices (docs/design.html PA-16) on a
 * made-up two-GPU laptop, drawn as the session draws them. For review in
 * the VM, which has one GPU and no battery. The real GraphicsController,
 * its teller and decision, the notices' one place, the notification store,
 * the banner stack and the Automatic refresh rate run on stand-ins: an
 * NVIDIA card (nothing read from sysfs), a cardwire that takes any mode, a
 * built-in 120/60 Hz screen, and, for `waited`, "Steam" holding the card.
 * Nothing here reaches hardware, cardwire or the session's screens; only
 * the banners open, as overlays like the session's own. Run it by hand, in
 * the session's environment:
 *
 *   dashi-graphics-preview unplug|plug|waited [--dark] [--after S] [--quit S] [--seconds S]
 *
 * `--after`: seconds before the cable changes (3); `--quit`: for `waited`,
 * seconds after that before Steam quits (12); `--seconds`: how long it stays
 * up (90). Banners never expire here, so they can be looked at.
 */

import { setAppearanceSource } from "@dashi/ui";
import { outputsOf } from "../src/compositor/outputs.ts";
import { AutoRefresh, rateOnPower } from "../src/display-config/auto-refresh.ts";
import type { ApplyResult } from "../src/display-config/manager.ts";
import { monitorsOf } from "../src/display-config/monitors.ts";
import type { GraphicsCard } from "../src/graphics/card.ts";
import type { CardwireGpu, CardwireMode, GraphicsBackend } from "../src/graphics/cardwire.ts";
import { GraphicsController } from "../src/graphics/controller.ts";
import type { ProcessFds } from "../src/graphics/holders.ts";
import { graphicsNoticePlace } from "../src/graphics/notice-place.ts";
import { BannerStack } from "../src/notifications/stack.tsx";
import { NotificationStore } from "../src/notifications/store.ts";
import { spawnShellHost } from "../src/shared/metal/index.ts";

const args = process.argv.slice(2);
const scene = args.find((arg) => !arg.startsWith("--") && Number.isNaN(Number(arg))) ?? "unplug";
if (scene !== "unplug" && scene !== "plug" && scene !== "waited") {
  console.error(`dashi-graphics-preview: no scene "${scene}" (unplug, plug, waited)`);
  process.exit(2);
}
const number = (flag: string, fallback: number): number => {
  const at = args.indexOf(flag);
  const value = at >= 0 ? Number(args[at + 1]) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
};
const after = number("--after", 3);
const quitAfter = number("--quit", 12);
const seconds = number("--seconds", 90);
const dark = args.includes("--dark");
setAppearanceSource({ subscribe: () => () => {}, isDark: () => dark });

const log = (line: string): void => console.log(`${(performance.now() / 1000).toFixed(1).padStart(6)} s  ${line}`);
let plugged = scene !== "plug";

// The built-in screen, as dashi-comp would report it: 2880 × 1800 at 120 and 60 Hz.
let refreshMhz = plugged ? 120_000 : 60_000;
const outputs = () => ({
  outputs: [
    {
      name: "eDP-1",
      make: "",
      model: "",
      physicalMm: { width: 300, height: 190 },
      scale: 1.75,
      primary: true,
      frame: { x: 0, y: 0, width: 1646, height: 1029 },
      mode: { width: 2880, height: 1800, refreshMhz },
      modes: [
        { width: 2880, height: 1800, refreshMhz: 120_000, preferred: true, current: refreshMhz === 120_000 },
        { width: 2880, height: 1800, refreshMhz: 60_000, current: refreshMhz === 60_000 },
      ],
      vrr: { supported: false, active: false, mode: "off" },
    },
  ],
});
const refresh = new AutoRefresh({
  displays: {
    monitors: async () => monitorsOf(outputsOf(outputs())),
    setMode: async (_name, mode): Promise<ApplyResult> => {
      refreshMhz = mode.refreshMhz ?? refreshMhz;
      log(`screen: ${refreshMhz / 1000} Hz`);
      return { kept: true, reverted: false };
    },
    onModeChange: () => () => {},
  },
  choice: () => "automatic",
  ready: () => true,
});
refresh.start();
refresh.setPlugged(plugged);

// The card and cardwire: an NVIDIA card beside the built-in GPU, Automatic chosen.
const card: GraphicsCard = { name: "card1", driver: "nvidia", pci: "0000:65:00.0", port: "0000:00:01.1", nodes: ["/dev/nvidia0"], screens: [] };
let mode: CardwireMode = plugged ? "hybrid" : "integrated";
const gpu: CardwireGpu = { path: "/gpu/1", name: "RTX 4070", pci: card.pci, card: 1, isDefault: false, discrete: true, driver: "nvidia" };
const backend: GraphicsBackend = {
  mode: async () => mode,
  setMode: async (next) => {
    mode = next;
    log(`cardwire: ${next}`);
    return true;
  },
  gpus: async () => [gpu],
  holders: async () => [],
  allowed: async () => [],
  onModeChanged: () => () => {},
  takeOver: async () => {},
};
const steam: ProcessFds = { pid: 5900, comm: "steam", links: ["/dev/nvidia0"] };
let running: ProcessFds[] = scene === "waited" ? [steam] : [];

const notifications = new NotificationStore({ schedule: () => () => {} });
const banners = new BannerStack(notifications, (options) => spawnShellHost(options));
banners.start();
notifications.subscribe(() => {
  const shown = notifications.getSnapshot().live.map((each) => `“${each.summary}” · ${each.body} [${each.actions.map((action) => action.label).join(", ")}]`);
  log(`notices: ${shown.length === 0 ? "none" : shown.join(" | ")}`);
});

const place = graphicsNoticePlace(notifications, {
  keepHybrid: () => graphics.keepHybrid(),
  openSettings: () => log("Graphics Settings… pressed"),
});
const graphics = new GraphicsController({
  card,
  backend,
  choice: () => "automatic",
  saveChoice: () => {},
  appOf: (pid) => (pid === steam.pid ? "Steam" : null),
  ...place.deps,
  rate: (on) => rateOnPower(refresh.getSnapshot(), on),
  processes: () => running,
  screens: () => [],
  power: () => (mode === "integrated" ? "suspended" : "active"),
  cardWatts: () => null,
  signal: () => {},
});
graphics.setPlugged(plugged);
await graphics.start();
log(`${scene}: ${plugged ? "plugged in" : "on battery"}, ${mode}${running.length > 0 ? ", Steam on the card" : ""}`);

setTimeout(() => {
  plugged = !plugged;
  log(plugged ? "cable in" : "cable out");
  refresh.setPlugged(plugged);
  graphics.setPlugged(plugged);
  if (scene !== "waited") return;
  setTimeout(() => {
    running = [];
    log("Steam quit");
    void graphics.refresh();
  }, quitAfter * 1000);
}, after * 1000);

setTimeout(() => {
  banners.close();
  graphics.close();
  refresh.close();
  place.close();
  process.exit(0);
}, seconds * 1000);
