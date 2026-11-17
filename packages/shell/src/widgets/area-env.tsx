/** The env every widget reads, made once per surface (the area, the lock screen, Glance). */

import { useMemo } from "react";
import { useInks } from "../shared/inks/index.ts";
import { useClockPrefs, useMinuteClock, usesHour24 } from "../shared/time/index.ts";
import { useTally } from "../tally/index.ts";
import type { WidgetEnv } from "./env.tsx";
import type { WidgetHub } from "./hub.ts";
import { useSource } from "./lib/data.ts";
import type { Placement } from "./types.ts";

export function useWidgetEnvFor(
  hub: WidgetHub | null,
  options: { locked: boolean; placements: readonly Placement[]; open: WidgetEnv["open"]; dark?: boolean; lock?: boolean },
): WidgetEnv {
  const now = useMinuteClock().getTime();
  const prefs = useClockPrefs();
  const tally = useTally();
  const inks = useInks({ ...(options.dark === undefined ? {} : { dark: options.dark }), ...(options.lock ? { lock: true } : {}) });
  const kinds = options.placements.map((each) => each.kind).join(",");
  return useMemo(
    () => ({ hub, now, hour24: usesHour24(prefs), tally, inks, locked: options.locked, placedKinds: kinds === "" ? [] : kinds.split(","), open: options.open }),
    [hub, now, prefs, tally, inks, options.locked, kinds, options.open],
  );
}

/** The person's widgets, from the hub's store. */
export function usePlacements(hub: WidgetHub | null): readonly Placement[] {
  return useSource(hub?.store, []);
}
