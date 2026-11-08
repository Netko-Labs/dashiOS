/**
 * The battery panel on the popover surface (menus/popover.tsx): under the
 * menu bar's battery item, or where Control Center was when its battery row
 * opened it. It reads the battery and the monitor as they change, takes a
 * fresh sample when it opens (so a plug-in shows at once), and Esc closes it.
 */

import { View } from "@mirinjs/metal";
import { useEffect } from "react";
import type { MenuEntry } from "../menus/model.ts";
import type { StatusMenuAction } from "../menus/status-menu.ts";
import { type SystemStore, useSystem } from "../system/store.ts";
import { type BatteryMonitor, useBatteryMonitor } from "./monitor.ts";
import { BATTERY_PANEL, BatteryPanel } from "./panel.tsx";

export interface BatteryPopoverSources {
  system: SystemStore;
  monitor?: BatteryMonitor;
  /** The charge limit in percent now; null without one. */
  chargeLimit: () => number | null;
  /** Read again what changes rarely as the panel opens (the graphics card's holders). */
  refresh?: () => void;
  /** What the laptop adds (the charge, the graphics card's holders, what keeps it awake). */
  extras: () => readonly MenuEntry<StatusMenuAction>[];
  onApp: (app: { key: string; name: string }) => void;
  onAction: (action: StatusMenuAction) => void;
  onSettings: () => void;
}

const NO_MONITOR = { subscribe: () => () => {}, getSnapshot: () => null } as const;

function useMonitor(monitor: BatteryMonitor | undefined) {
  // A hook can't be skipped: without a monitor, a store that never changes.
  return useBatteryMonitor((monitor ?? NO_MONITOR) as BatteryMonitor) as ReturnType<typeof useBatteryMonitor> | null;
}

export function BatteryPopover({
  sources,
  right,
  screenWidth,
  close,
}: {
  sources: BatteryPopoverSources;
  /** The panel's right edge in screen points; null: Control Center's place. */
  right: number | null;
  screenWidth: number | null;
  close: () => void;
}) {
  const { battery } = useSystem(sources.system);
  const use = useMonitor(sources.monitor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the panel opens (the sources are rebuilt with each draw).
  useEffect(() => {
    void sources.monitor?.sample();
    sources.refresh?.();
  }, []);
  if (!battery) return null;
  const place =
    right === null || screenWidth === null ? { right: 8 } : { left: Math.max(8, Math.min(right - BATTERY_PANEL.width, screenWidth - BATTERY_PANEL.width - 8)) };
  return (
    <View occlude testID="battery-popover" onWindowKeyDown={(key) => key.key === "escape" && close()} style={{ position: "absolute", top: 4, ...place }}>
      <BatteryPanel
        battery={battery}
        use={use?.available ? use : null}
        limit={sources.chargeLimit()}
        extras={sources.extras()}
        now={Date.now() / 1000}
        onApp={(app) => {
          close();
          sources.onApp(app);
        }}
        onAction={(action) => {
          close();
          sources.onAction(action);
        }}
        onSettings={() => {
          close();
          sources.onSettings();
        }}
      />
    </View>
  );
}
