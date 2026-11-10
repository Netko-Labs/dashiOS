/** The battery monitor on the machine's own sources: /sys, /proc, the compositor's windows, the power-profiles daemon (tuned-ppd). */

import { appFor } from "../apps.ts";
import type { Compositor } from "../compositor/index.ts";
import type { App } from "../shared/apps/index.ts";
import { type AppCatalog, catalogFrom, readerMemory, readSnapshot, sysconf } from "../shared/processes/index.ts";
import { readPowerSupplies } from "../system/battery.ts";
import { readBatteryDetails } from "../system/battery-details.ts";
import { powerProfiles } from "../system/profiles.ts";
import { systemBus } from "../system/system-bus.ts";
import { HistoryFile } from "./lib/file.ts";
import { BatteryMonitor } from "./monitor.ts";

export interface BatteryMonitorOptions {
  compositor: Pick<Compositor, "windows"> | null;
  apps: readonly App[];
  installed?: (appId: string) => App | undefined;
  /** The installed apps (app-catalog.ts's list), to name processes as Activity Monitor does; read when a look first needs them. */
  entries?: () => Parameters<typeof catalogFrom>[0];
}

export function startBatteryMonitor(options: BatteryMonitorOptions): BatteryMonitor {
  const pageSize = sysconf("PAGESIZE", 4096);
  const uid = process.getuid?.() ?? -1;
  const profiles = powerProfiles(systemBus());
  // Kept between looks, so a process's command line and app are read once.
  const memory = readerMemory();
  let catalog: AppCatalog | undefined;
  let counted = -1;
  const monitor = new BatteryMonitor({
    supplies: readPowerSupplies,
    processes: () => {
      const entries = options.entries?.();
      // An app installed meanwhile (the list grew): processes are matched again.
      if (entries && entries.length !== counted) {
        catalog = catalogFrom(entries);
        counted = entries.length;
        memory.known.clear();
      }
      return readSnapshot({ io: false, sockets: false, ownUid: uid, pageSize, memory, ...(catalog ? { apps: catalog } : {}) }).processes;
    },
    windows: async () => {
      const windows = options.compositor ? await options.compositor.windows().catch(() => []) : [];
      return windows.flatMap((window) =>
        window.pid === null
          ? []
          : [
              {
                pid: window.pid,
                // The installed app's id, as Activity Monitor keys it, when the window's app id names one.
                key: (window.appId && options.installed?.(window.appId)?.id) || window.appId || `window:${window.id}`,
                name: appFor(options.apps, window, options.installed).name,
              },
            ],
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
