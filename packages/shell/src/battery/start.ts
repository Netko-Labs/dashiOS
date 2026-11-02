/** The battery monitor on the machine's own sources: /sys, /proc, the compositor's windows, power-profiles-daemon. */

import { readSnapshot, sysconf } from "../../apps/activity-monitor/read.ts";
import { type App, appFor } from "../apps.ts";
import type { Compositor } from "../compositor.ts";
import { readPowerSupplies } from "../system/battery.ts";
import { readBatteryDetails } from "../system/battery-details.ts";
import { run } from "../system/exec.ts";
import { powerprofilesctl } from "../system/profiles.ts";
import { HistoryFile } from "./file.ts";
import { BatteryMonitor } from "./monitor.ts";

export interface BatteryMonitorOptions {
  compositor: Pick<Compositor, "windows"> | null;
  apps: readonly App[];
  installed?: (appId: string) => App | undefined;
}

export function startBatteryMonitor(options: BatteryMonitorOptions): BatteryMonitor {
  const pageSize = sysconf("PAGESIZE", 4096);
  const uid = process.getuid?.() ?? -1;
  const profiles = powerprofilesctl(run);
  const monitor = new BatteryMonitor({
    supplies: readPowerSupplies,
    processes: () => readSnapshot({ io: false, sockets: false, ownUid: uid, pageSize, names: new Map() }).processes,
    windows: async () => {
      const windows = options.compositor ? await options.compositor.windows().catch(() => []) : [];
      return windows.flatMap((window) =>
        window.pid === null
          ? []
          : [{ pid: window.pid, key: window.appId || `window:${window.id}`, name: appFor(options.apps, window, options.installed).name }],
      );
    },
    health: async () => (await readBatteryDetails())?.health ?? null,
    lowPower: async () => {
      const read = await profiles.read();
      return read ? read.active === "power-saver" : null;
    },
    file: new HistoryFile(),
    uid,
    hz: sysconf("CLK_TCK", 100),
    now: () => Date.now() / 1000,
  });
  void monitor.start().catch((error) => console.error("dashi-shell: battery monitor:", error instanceof Error ? error.message : error));
  return monitor;
}
