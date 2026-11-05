/**
 * What Desktops are called. A name the person gave sticks (settings.json
 * `spaces.names`, one entry per Desktop, null for none); a Desktop without
 * one is called after the apps on it ("Helium, Terminal"), and "Desktop 2"
 * only while it is empty. The rule for "the apps on it": its windows that
 * show (not minimized or hidden), most recently used first, one per app; the
 * first two by name, and how many more. Pure, so the rules are tested.
 */

import type { CompositorWindow } from "../compositor.ts";
import { MAX_SPACES, spaceLabel } from "./model.ts";

/** The longest name kept, in characters. */
export const MAX_NAME = 32;
/** Apps named in an automatic name; the rest are counted. */
const NAMED_APPS = 2;

export type SpaceNames = (string | null)[];

/** A name as typed, tidied: spaces collapsed, cut to MAX_NAME; null when nothing is left. */
export function cleanName(text: string): string | null {
  const name = [...text.replace(/\s+/g, " ").trim()].slice(0, MAX_NAME).join("").trim();
  return name.length > 0 ? name : null;
}

/** `spaces.names` from settings.json, checked; null when it is not a list of names and nulls. */
export function parseSpaceNames(value: unknown): SpaceNames | null {
  if (!Array.isArray(value) || value.length > MAX_SPACES) return null;
  const names: SpaceNames = [];
  for (const entry of value) {
    if (entry === null) names.push(null);
    else if (typeof entry === "string") names.push(cleanName(entry));
    else return null;
  }
  return trimNames(names);
}

/** Without the nulls at the end (they say nothing). */
function trimNames(names: SpaceNames): SpaceNames {
  const last = names.findLastIndex((name) => name !== null);
  return names.slice(0, last + 1);
}

/** The names with Desktop `index` called `text` (or nothing, which goes back to the automatic name). */
export function renamed(names: SpaceNames, index: number, text: string): SpaceNames {
  if (index < 0 || index >= MAX_SPACES) return trimNames(names);
  const next = Array.from({ length: Math.max(names.length, index + 1) }, (_, at) => names[at] ?? null);
  next[index] = cleanName(text);
  return trimNames(next);
}

/** The names after Desktop `index` was removed: the ones after it move down one, as the Desktops do. */
export function withoutSpace(names: SpaceNames, index: number): SpaceNames {
  return trimNames(names.filter((_, at) => at !== index));
}

/** Windows of one app, as shortcuts.ts `sameApp` has it (not imported: settings.ts reads this file). */
const sameApp = (a: CompositorWindow, b: CompositorWindow): boolean => (a.appId && b.appId ? a.appId === b.appId : a.pid !== null && a.pid === b.pid);

/** One window per app among `windows`, in their order. */
function appsOf(windows: readonly CompositorWindow[]): CompositorWindow[] {
  const picked: CompositorWindow[] = [];
  for (const window of windows) if (!picked.some((each) => sameApp(each, window))) picked.push(window);
  return picked;
}

/**
 * Desktop `index`'s automatic name from the windows (front to back, as the
 * compositor lists them), or null when nothing shows on it. `appName` is
 * what the Dock calls a window's app.
 */
export function autoName(index: number, windows: readonly CompositorWindow[], appName: (window: CompositorWindow) => string): string | null {
  const shown = windows.filter((window) => (window.space ?? 0) === index && window.state === "normal");
  const names = [
    ...new Set(
      appsOf(shown)
        .map(appName)
        .filter((name) => name.length > 0),
    ),
  ];
  if (names.length === 0) return null;
  const listed = names.slice(0, NAMED_APPS).join(", ");
  const more = names.length - NAMED_APPS;
  return more > 0 ? `${listed} +${more}` : listed;
}

/** What each of `count` Desktops is called: the given name, else after its apps, else "Desktop N". */
export function spaceLabels(count: number, names: SpaceNames, windows: readonly CompositorWindow[], appName: (window: CompositorWindow) => string): string[] {
  return Array.from({ length: count }, (_, index) => names[index] ?? autoName(index, windows, appName) ?? spaceLabel(index));
}
