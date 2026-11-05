/**
 * The recipe's screen line (60 Hz on battery, the panel's top rate plugged
 * in): the built-in panel's refresh rate at its current size, set through
 * the compositor's `outputs-config` with only the mode changed. External
 * screens are the person's (Displays), never a recipe's.
 */

import type { Compositor } from "../../compositor.ts";
import { type Mode, type Monitor, parseMonitors } from "../../display-config/monitors.ts";
import { toWire } from "../../display-config/plan.ts";

/** The mode of `monitor`'s current size closest to `rate` (Hz; "max" for the highest); null when nothing would change. */
export function rateMode(monitor: Monitor, rate: number | "max"): Mode | null {
  const current = monitor.mode;
  if (!current) return null;
  const sameSize = monitor.modes.filter((mode) => mode.width === current.width && mode.height === current.height);
  if (sameSize.length === 0) return null;
  const pick =
    rate === "max"
      ? sameSize.reduce((best, mode) => (mode.refreshMhz > best.refreshMhz ? mode : best))
      : sameSize.reduce((best, mode) => (Math.abs(mode.refreshMhz - rate * 1000) < Math.abs(best.refreshMhz - rate * 1000) ? mode : best));
  if (pick.refreshMhz === current.refreshMhz) return null;
  return { width: pick.width, height: pick.height, refreshMhz: pick.refreshMhz };
}

/** Sets the built-in panel's rate for a recipe. */
export function screenRateApplier(compositor: Pick<Compositor, "request">): (rate: number | "max") => Promise<void> {
  return async (rate) => {
    const panel = parseMonitors(await compositor.request("outputs")).find((monitor) => monitor.builtIn && monitor.enabled);
    const mode = panel ? rateMode(panel, rate) : null;
    if (!panel || !mode) return;
    await compositor.request("outputs-config", toWire({ outputs: [{ name: panel.name, mode }] }));
  };
}
