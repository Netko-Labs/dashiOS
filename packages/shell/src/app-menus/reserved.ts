/**
 * Which ❖ chords the keymap takes before a Dashi app's menus see them. The
 * compositor tries the keymap's rules in order and the first match wins
 * (keymap.ts), and the `app-chord` rule, which hands a chord to the focused
 * app's menus, comes after the shell's own: ❖Q ❖H ❖M ❖, ❖⌫, the ❖ arrows
 * (and the same with ⇧, since a rule that does not name Shift ignores it), every
 * ⌃❖ and ⌥❖ chord but the two with a binding, ⇧❖3, ⇧❖4, ❖Space, and the
 * switchers. A menu row showing one of them would draw a shortcut that never
 * works, so the apps' tests refuse it. ❖W and ⇧❖W are the exception: the
 * shell offers them to the app's own row first (Close Tab, Close Window) and
 * closes the window only when it has none (shortcuts.ts).
 */

import { KEYMAP, type Keymap, type Rule } from "../keymap.ts";
import type { PressedChord } from "./shortcut.ts";

/** The rule that gives ❖ chords to the app's menus. */
const APP_CHORD = "app-chord";
/** Bindings that offer their chord to the app's menus before acting themselves. */
const APP_FIRST: ReadonlySet<string> = new Set(["close-window"]);

interface Parsed {
  super: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  keys: readonly string[];
}

function parseWhen(when: string): Parsed {
  const tokens = when.split("+");
  const keys = (tokens.pop() ?? "").split("|");
  return {
    super: tokens.includes("super"),
    ctrl: tokens.includes("ctrl"),
    alt: tokens.includes("alt"),
    shift: tokens.includes("shift"),
    keys,
  };
}

function matchesKey(keys: readonly string[], key: string): boolean {
  return keys.some((wanted) => wanted === "*" || (wanted === "letter" ? /^[a-z]$/.test(key) : wanted === key));
}

/** Whether `rule` takes `chord` (Super held) from a Dashi app (the keymap's `metal` class). */
function takes(rule: Rule, chord: PressedChord): boolean {
  if (rule.app !== undefined && rule.app !== "metal") return false;
  const when = parseWhen(rule.when);
  // Super, Ctrl, and Alt match exactly; Shift only when the rule names it.
  if (!when.super || when.ctrl !== chord.ctrl || when.alt !== chord.alt) return false;
  if (when.shift && !chord.shift) return false;
  return matchesKey(when.keys, chord.key);
}

/**
 * The rule that takes the ❖ chord before `app-chord` does, written as the
 * keymap writes it ("super+q"), or null when the chord reaches the app's menus.
 */
export function reservedBy(chord: PressedChord, keymap: Keymap = KEYMAP): string | null {
  for (const rule of keymap.rules) {
    if (rule.bind === APP_CHORD) return null;
    if (takes(rule, chord)) return rule.bind !== undefined && APP_FIRST.has(rule.bind) ? null : rule.when;
  }
  return null;
}
