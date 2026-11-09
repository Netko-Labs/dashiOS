/**
 * The menu bar from the keyboard (docs/design.html, "The menu bar"), as the
 * Mac's "Move focus to the menu bar": ⌃F2 (keymap.ts) puts the purple ring
 * on the Dashi menu; ← and → move across the menus, then the status items,
 * as they are drawn left to right (wrapping at the ends); Return, Space or
 * ↓ opens the item's menu or panel; inside a menu ↑ ↓ move, Return
 * chooses, and ← → go to the next title, opening its menu; Esc closes the
 * menu and a second Esc leaves the bar, and the window that had the
 * keyboard has it again. Pure: the controller (controller.ts) keeps the
 * state, the bar (menubar.tsx) says what its stops are.
 */

import type { Popover } from "./controller.ts";
import type { BarMenuId } from "./model.ts";

/**
 * What a stop does when opened: `menu` drops its title's menu, `panel`
 * opens a popover (Control Center, the agents' panel, an item's menu), and
 * `action` does something and leaves the bar (an app's item that
 * activates, the recording's stop).
 */
export type StopKind = "menu" | "panel" | "action";

/** One place the ring can stand in the bar. */
export interface BarStop {
  /** `menu:<id>` for a title, the status slot's key otherwise ("agent-mark", "extra:…", "more", "clock"). */
  key: string;
  /** What a screen reader says for it. */
  label: string;
  kind: StopKind;
  /** Opens it, as a click on it does. */
  open(): void;
}

/** A title's stop key. */
export const titleStop = (id: BarMenuId): string => `menu:${id}`;

/** "…"'s stop key (menubar-status.tsx). */
export const MORE_STOP = "more";

/** The bar's stops in order: the menus' titles left to right, then the status side's row as drawn. */
export function barOrder(titles: readonly BarMenuId[], status: readonly string[]): string[] {
  return [...titles.map(titleStop), ...status];
}

/** The stop ← (`left`) or → (`right`) goes to, wrapping at the ends; from none, or one that went, → the first and ← the last. */
export function stepStop(order: readonly string[], current: string | null, toward: "left" | "right"): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return (toward === "right" ? order[0] : order.at(-1)) ?? null;
  const next = (at + (toward === "right" ? 1 : -1) + order.length) % order.length;
  return order[next] ?? null;
}

/** What a key does while the ring is in the bar and nothing is open. */
export type BarCommand = { kind: "move"; toward: "left" | "right" } | { kind: "open" } | { kind: "leave" } | null;

/** A key's meaning in the bar (GPUI's key names: "left", "enter", "escape"). */
export function barCommand(key: string): BarCommand {
  switch (key) {
    case "left":
    case "right":
      return { kind: "move", toward: key };
    case "enter":
    case "space":
    case "down":
      return { kind: "open" };
    case "escape":
      return { kind: "leave" };
    default:
      return null;
  }
}

/** The stop of what is open, when it opened from the bar: a title's menu, an item's menu or panel. */
export function stopOfPopover(popover: Popover | null): string | null {
  switch (popover?.kind) {
    case "menu":
      return titleStop(popover.id);
    case "status-menu":
      return popover.key === "battery" ? "battery" : `extra:${popover.key}`;
    case "agents":
      return "agent-mark";
    case "overflow":
      return MORE_STOP;
    case "notification-center":
      return "clock";
    case "battery":
      return popover.right === null ? "control-center" : "battery";
    case "control-center":
      return popover.page === "wifi" ? "network" : "control-center";
    default:
      return null;
  }
}

/**
 * ← or → inside a menu that dropped from the bar: the stop it goes to, and
 * whether that one's menu opens too. Going along the titles keeps a menu
 * open, as on a Mac; reaching a status item closes it and the ring stands
 * there, for Return to open.
 */
export function sideStep(
  stops: readonly Pick<BarStop, "key" | "kind">[],
  current: string | null,
  toward: "left" | "right",
): { key: string; opens: boolean } | null {
  const key = stepStop(
    stops.map((stop) => stop.key),
    current,
    toward,
  );
  if (key === null) return null;
  return { key, opens: stops.find((stop) => stop.key === key)?.kind === "menu" };
}
