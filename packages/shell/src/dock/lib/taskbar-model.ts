/**
 * What the taskbar shows and what a click on it does, as pure functions of
 * the Dock's layout (layout.ts), like the Dock's own (apps.ts `clickAction`).
 *
 * One button per window, as in Windows: the apps kept in the Dock come
 * first, in their order, then the rest in the order they first appeared; an
 * app's windows sit together. A kept app with no window is a launcher
 * button: just its icon. Minimized windows keep their button (dimmed).
 */

import type { Toplevel } from "@mirinjs/metal";
import { canLaunch } from "../../apps.ts";
import type { DockEntry, DockLayout } from "../layout.ts";

export interface TaskbarButton {
  /** Stable while the window (or the launcher) stays: React's key. */
  key: string;
  /** The app it belongs to (menus, attention). */
  entry: DockEntry;
  /** Null for a kept app that has no window. */
  window: Toplevel | null;
  /** The window's title, else the app's name; empty for a launcher (icon only). */
  label: string;
}

/** The longest title a button names; the button then cuts it short with an ellipsis, but a title this long is a document path. */
export const TITLE_LIMIT = 80;

export function taskbarButtons(layout: DockLayout): TaskbarButton[] {
  return [...layout.pinned, ...layout.running].flatMap((entry): TaskbarButton[] => {
    if (entry.windows.length === 0) return [{ key: `app:${entry.key}`, entry, window: null, label: "" }];
    return entry.windows.map((window) => ({
      key: `window:${window.id}`,
      entry,
      window,
      label: (window.title.trim() || entry.app.name).slice(0, TITLE_LIMIT),
    }));
  });
}

/**
 * The center of each kept app's group of buttons, in `order`, from where the
 * buttons were laid out; null when any of them has not been measured (a drag
 * then falls back to a fixed distance). An app with several windows is one
 * group: its buttons sit together and move as one.
 */
export function taskbarCenters(
  order: readonly string[],
  buttons: readonly Pick<TaskbarButton, "key" | "entry">[],
  laid: ReadonlyMap<string, { x: number; width: number }>,
): number[] | null {
  const centers: number[] = [];
  for (const key of order) {
    const spans = buttons.filter((button) => button.entry.key === key).map((button) => laid.get(button.key));
    if (spans.length === 0 || spans.some((span) => span === undefined)) return null;
    const boxes = spans as Array<{ x: number; width: number }>;
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    centers.push((left + right) / 2);
  }
  return centers;
}

export type TaskbarAction =
  | { kind: "launch" }
  /** Bring the window forward; a minimized one is restored by this. */
  | { kind: "activate"; window: number }
  | { kind: "minimize"; window: number }
  | { kind: "none" };

/**
 * Windows' rule: a click on a minimized window's button restores it, on the
 * focused window's button minimizes it, and on any other brings it forward.
 */
export function taskbarClick(button: Pick<TaskbarButton, "window" | "entry">): TaskbarAction {
  const { window } = button;
  if (!window) return canLaunch(button.entry.app) ? { kind: "launch" } : { kind: "none" };
  if (window.minimized) return { kind: "activate", window: window.id };
  if (window.activated) return { kind: "minimize", window: window.id };
  return { kind: "activate", window: window.id };
}
