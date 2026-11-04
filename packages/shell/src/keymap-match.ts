/**
 * The keymap's rules (keymap.ts) applied here, the way dashi-comp applies
 * them to the person's keys (comp/src/keys/keymap.rs): the first rule whose
 * `when` and app class match wins. An agent's key presses reach the window
 * without passing the compositor's keyboard handler, so the shell resolves
 * them first and ❖ and ⌥ mean for an agent what they mean for the person.
 */

import { KEYMAP, type Keymap, type Rule } from "./keymap.ts";

export type Mod = "super" | "ctrl" | "alt" | "shift";

/** One key and the modifiers held with it; `key` is an xkb keysym name ("s", "Left"). */
export interface KeyChord {
  mods: readonly Mod[];
  key: string;
}

/** What a chord comes to: keys for the window, a shell action, or nothing. */
export type Resolved = { kind: "keys"; chords: KeyChord[] } | { kind: "bind"; name: string } | { kind: "swallow" };

interface When {
  super: boolean;
  ctrl: boolean;
  alt: boolean;
  /** Matched only when the rule names it. */
  shift: boolean;
  keys: readonly string[];
}

function parseWhen(when: string): When {
  const tokens = when.split("+");
  const keys = (tokens.pop() ?? "").split("|");
  return { super: tokens.includes("super"), ctrl: tokens.includes("ctrl"), alt: tokens.includes("alt"), shift: tokens.includes("shift"), keys };
}

/** Whether `appId` is in the keymap's app class `name`: exact ids, or prefixes ending in `*`. */
export function inClass(keymap: Keymap, name: string, appId: string): boolean {
  return (keymap.apps[name] ?? []).some((pattern) => (pattern.endsWith("*") ? appId.startsWith(pattern.slice(0, -1)) : pattern === appId));
}

const has = (chord: KeyChord, mod: Mod): boolean => chord.mods.includes(mod);

function matches(keymap: Keymap, rule: Rule, chord: KeyChord, appId: string): boolean {
  const when = parseWhen(rule.when);
  if (when.super !== has(chord, "super") || when.ctrl !== has(chord, "ctrl") || when.alt !== has(chord, "alt")) return false;
  if (when.shift && !has(chord, "shift")) return false;
  const key = when.keys.some((wanted) => wanted === "*" || (wanted === "letter" ? /^[a-z]$/.test(chord.key) : wanted === chord.key));
  return key && (rule.app === undefined || inClass(keymap, rule.app, appId));
}

/** The rule that takes `chord` in a window of `appId`, or null when none does and the window gets it as pressed. */
export function ruleFor(chord: KeyChord, appId: string, keymap: Keymap = KEYMAP): Rule | null {
  return keymap.rules.find((rule) => matches(keymap, rule, chord, appId)) ?? null;
}

/** A rule's chord text ("ctrl+shift+key", "Home") made concrete: `key` is the pressed key, and Shift held passes through when `keepShift`. */
function concrete(text: string, pressed: KeyChord, keepShift: boolean): KeyChord {
  const tokens = text.split("+");
  const name = tokens.pop() ?? "";
  const mods = tokens.filter((token): token is Mod => token === "ctrl" || token === "alt" || token === "shift" || token === "super");
  if (keepShift && has(pressed, "shift") && !mods.includes("shift")) mods.push("shift");
  return { mods, key: name === "key" ? pressed.key : name };
}

/** What `chord` comes to in a window of `appId`, as for the person: `send` holds the new chord, `tap` presses its chords in turn. */
export function resolveChord(chord: KeyChord, appId: string, keymap: Keymap = KEYMAP): Resolved {
  const rule = ruleFor(chord, appId, keymap);
  if (!rule) return { kind: "keys", chords: [chord] };
  if (rule.send !== undefined) return { kind: "keys", chords: [concrete(rule.send, chord, true)] };
  if (rule.tap !== undefined) return { kind: "keys", chords: rule.tap.map((tap) => concrete(tap, chord, false)) };
  if (rule.bind !== undefined) return { kind: "bind", name: rule.bind };
  return { kind: "swallow" };
}
