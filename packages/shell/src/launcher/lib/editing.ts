/**
 * Set alias… and Set shortcut…, in the launcher's own field (the chip names
 * what they are for): the rows say what Return will keep, and why not when
 * it can't. Pure, so the tests read it.
 */

import { type Collision, chordLabel, isAlias } from "../person-keys.ts";
import { fold } from "../ranking/fold.ts";
import type { Row } from "../row-model.ts";

const none = { none: true } as const;
const nothing = { kind: "type", query: "" } as const;

/** What Return keeps in the alias field: the alias, or null when there is nothing (yet) to keep. */
export function aliasToKeep(text: string): string | null {
  const alias = text.trim();
  return isAlias(alias) ? alias : null;
}

/** The alias field's rows: Return keeps it, saying which address it moves from. */
export function aliasRows(text: string, title: string, address: string, aliases: ReadonlyMap<string, string>, nameOf: (address: string) => string): Row[] {
  const alias = aliasToKeep(text);
  if (text.trim() === "")
    return [{ id: "alias:hint", title: `Type an alias for ${title}`, detail: "a short word, like ff", kind: "", icon: none, action: nothing }];
  if (!alias)
    return [{ id: "alias:bad", title: "An alias is a word or two", detail: "letters, digits, spaces, up to 32", kind: "", icon: none, action: nothing }];
  const now = aliases.get(fold(alias));
  const moves = now !== undefined && now !== address;
  return [
    {
      id: "alias:keep",
      title: `Use “${alias}” for ${title}`,
      ...(moves ? { detail: `instead of ${nameOf(now)}` } : {}),
      kind: "",
      icon: none,
      action: nothing,
      shortcut: "↩",
    },
  ];
}

/** What the recorder says about a chord, and whether Return may keep it. */
export function shortcutRows(when: string | null, title: string, found: Collision | null): Row[] {
  if (when === null || found === null) {
    return [
      {
        id: "shortcut:hint",
        title: `Press the keys for ${title}`,
        detail: "❖ and a key, with ⌃, ⌥ or ⇧ if you like",
        kind: "",
        icon: none,
        action: nothing,
      },
    ];
  }
  const label = chordLabel(when);
  if (found.kind === "reserved")
    return [{ id: "shortcut:reserved", title: "Dashi keeps", chord: label, detail: "press another", kind: "", icon: none, action: nothing }];
  return [
    {
      id: "shortcut:keep",
      title: `Use for ${title}`,
      chord: label,
      ...(found.kind === "taken" ? { detail: `instead of ${found.does}` } : {}),
      kind: "",
      icon: none,
      action: nothing,
      shortcut: "↩",
    },
  ];
}

/** Whether Return keeps the recorded chord. */
export const mayKeep = (when: string | null, found: Collision | null): boolean => when !== null && found !== null && found.kind !== "reserved";
