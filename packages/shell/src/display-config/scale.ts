/**
 * The scale a monitor gets running a mode: the person's saved one when it
 * fits, else the default for its pixel density. A chosen scale is kept by the
 * monitor's identity (displays.json `scales`), so it follows the monitor to
 * another port and another monitor on that port gets its own (decisions.md
 * D551). Before 0.10 it was kept by port in settings.json (`displays.<port>.scale`):
 * the first monitor seen on that port takes it over.
 */

import { initialScale, type MonitorId, type SavedScale } from "../displays.ts";
import { identityOf, type Mode, type Monitor, type Rotation } from "./monitors.ts";
import type { ScaleFor } from "./plan.ts";
import type { DisplayStore } from "./saved.ts";

/** settings.json's scales by port, from before they were kept by monitor. */
export interface PortScales {
  displayScale(name: string): number | undefined;
  setDisplayScale(name: string, scale: number | undefined): void;
}

/** The scales people chose, by monitor. */
export class ScreenScales {
  constructor(
    private readonly store: Pick<DisplayStore, "scale" | "setScale">,
    private readonly ports: PortScales | null = null,
  ) {}

  /** The scale chosen for this monitor, if one was. */
  of: SavedScale = (monitor: MonitorId): number | undefined => {
    const identity = identityOf(monitor);
    const kept = this.store.scale(identity);
    if (kept !== undefined || !this.ports) return kept;
    const byPort = this.ports.displayScale(monitor.name);
    if (byPort === undefined) return undefined;
    // The port's scale was chosen for the monitor on it: it is this monitor's now, and the port's is gone.
    this.store.setScale(identity, byPort);
    try {
      this.ports.setDisplayScale(monitor.name, undefined);
    } catch (error) {
      console.error("dashi-shell: could not move a screen's scale:", error instanceof Error ? error.message : error);
    }
    return byPort;
  };

  /** Remember the scale chosen for this monitor. */
  remember(monitor: MonitorId, scale: number): void {
    this.store.setScale(identityOf(monitor), scale);
  }
}

/** `saved` is the scale kept for a monitor, if the person chose one. */
export function scaleForMonitor(saved: SavedScale): ScaleFor {
  return (monitor: Monitor, mode: Mode, rotation: Rotation): number => {
    const sideways = rotation === 90 || rotation === 270;
    // Pixels and millimeters as the screen looks once turned.
    const [width, height] = sideways ? [mode.height, mode.width] : [mode.width, mode.height];
    const [widthMm, heightMm] = sideways ? [monitor.heightMm, monitor.widthMm] : [monitor.widthMm, monitor.heightMm];
    const { name, make, model, serial } = monitor;
    return initialScale({ name, make, model, serial, width, height, widthMm, heightMm, scale: monitor.scale }, saved);
  };
}
