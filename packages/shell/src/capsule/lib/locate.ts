/** Which screen the capsule goes on and what is there: the display of the window that has the keyboard, else the pointer's, else the primary. */

import type { DockPlace } from "../../dock/index.ts";
import type { PlaceInput } from "./place.ts";

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocateOutput {
  name: string;
  primary: boolean;
  enabled: boolean;
  frame: Area | null;
  usable: Area | null;
}

export interface LocateWindow {
  focused: boolean;
  state: string;
  frame: Area | null;
}

const holds = (area: Area, x: number, y: number): boolean => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;

/** The capsule's screen and what its place is worked out from; null when no screen says where it is. */
export function locate(
  outputs: readonly LocateOutput[],
  windows: readonly LocateWindow[],
  pointer: { x: number; y: number } | null,
  dock: DockPlace | null,
): { output: string; input: PlaceInput } | null {
  const screens = outputs.flatMap((output) =>
    output.enabled && output.frame && output.usable ? [{ name: output.name, primary: output.primary, frame: output.frame, usable: output.usable }] : [],
  );
  const focused = windows.find((window) => window.focused && window.state === "normal" && window.frame)?.frame ?? null;
  const screen =
    (focused && screens.find((each) => holds(each.frame, focused.x + focused.width / 2, focused.y + focused.height / 2))) ||
    (pointer && screens.find((each) => holds(each.frame, pointer.x, pointer.y))) ||
    screens.find((each) => each.primary) ||
    screens[0];
  if (!screen) return null;
  const shown = windows.flatMap((window) =>
    window.state === "normal" && window.frame && holds(screen.frame, window.frame.x + window.frame.width / 2, window.frame.y + window.frame.height / 2)
      ? [{ ...window.frame, focused: window.focused }]
      : [],
  );
  // The Dock is on one screen: on another there is none to sit clear of.
  const here = dock && (dock.output === undefined || dock.output === screen.name) ? dock : null;
  return { output: screen.name, input: { dock: here, screen: screen.frame, usable: screen.usable, windows: shown } };
}
