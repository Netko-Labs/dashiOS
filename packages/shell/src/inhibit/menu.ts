/**
 * "Keeping the Screen Awake" in the battery menu: each app holding the
 * screen or the computer awake, with its reason, and "Allow Sleep" to stop
 * them counting (store.ts `ignoreAll`). Nothing when no app holds.
 */

import type { MenuEntry } from "../menus/model.ts";
import type { Hold } from "./store.ts";

/** The battery menu's row that lets the computer sleep again. */
export interface AllowSleep {
  kind: "allow-sleep";
}

/** One line per app, the reason after a dot ("Firefox · Playing video"); an app asking twice is listed once. */
export function awakeLines(holds: readonly Hold[], nameOf: (appId: string) => string): string[] {
  const lines = new Map<string, string>();
  for (const hold of holds) {
    const name = (hold.appId && nameOf(hold.appId)) || hold.appId || "An app";
    if (lines.has(name)) continue;
    lines.set(name, hold.reason ? `${name} · ${hold.reason}` : name);
  }
  return [...lines.values()];
}

export function keepAwakeEntries<A>(holds: readonly Hold[], nameOf: (appId: string) => string, allowSleep: A): MenuEntry<A>[] {
  const lines = awakeLines(holds, nameOf);
  if (lines.length === 0) return [];
  const screen = holds.some((hold) => (hold.flags & 8) !== 0);
  return [
    { kind: "separator" },
    { kind: "item", label: screen ? "Keeping the Screen Awake" : "Keeping the Computer Awake", action: null },
    ...lines.slice(0, 5).map((label): MenuEntry<A> => ({ kind: "item", label: `    ${label}`, action: null })),
    { kind: "item", label: "Allow Sleep", action: allowSleep },
  ];
}
