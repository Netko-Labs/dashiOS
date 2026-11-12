/**
 * The moment a charger is plugged in: the HUD says so (osd-panel.tsx), as a
 * phone does, with the charge and whether the battery is taking it. Only a
 * change counts: the first reading after the shell starts, and a battery
 * that stays on power, show nothing.
 */

import type { Battery } from "../battery.ts";
import type { OsdState } from "../osd-state.ts";

const onPower = (battery: Battery): boolean => battery.state !== "discharging";

/** What to show for a new battery reading after `before` (undefined: none yet); null for nothing. */
export function pluggedIn(before: Battery | null | undefined, after: Battery | null): OsdState | null {
  if (before === undefined || before === null || after === null) return null;
  if (onPower(before) || !onPower(after)) return null;
  return { kind: "power", percent: after.percent, charge: after.state === "charging" ? true : "plugged" };
}

/** Watches `battery` readings and shows `osd` when a charger goes in; returns the way to stop. */
export function watchCharger(
  store: { subscribe(listener: () => void): () => void; getSnapshot(): { battery: Battery | null } },
  osd: { show(state: OsdState): void },
): () => void {
  let before: Battery | null | undefined;
  let read = false;
  return store.subscribe(() => {
    const after = store.getSnapshot().battery;
    if (read) {
      const show = pluggedIn(before, after);
      if (show) osd.show(show);
    }
    read = true;
    before = after;
  });
}
