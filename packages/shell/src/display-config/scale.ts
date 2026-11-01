/** The scale a monitor gets running a mode: the person's saved one when it fits, else the default for its pixel density. */

import { initialScale } from "../displays.ts";
import type { Mode, Monitor, Rotation } from "./monitors.ts";
import type { ScaleFor } from "./plan.ts";

/** `saved` is the scale kept for a connector (settings.json), if the person chose one. */
export function scaleForMonitor(saved: (name: string) => number | undefined): ScaleFor {
  return (monitor: Monitor, mode: Mode, rotation: Rotation): number => {
    const sideways = rotation === 90 || rotation === 270;
    // Pixels and millimeters as the screen looks once turned.
    const [width, height] = sideways ? [mode.height, mode.width] : [mode.width, mode.height];
    const [widthMm, heightMm] = sideways ? [monitor.heightMm, monitor.widthMm] : [monitor.widthMm, monitor.heightMm];
    return initialScale({ name: monitor.name, width, height, widthMm, heightMm, scale: monitor.scale }, saved);
  };
}
