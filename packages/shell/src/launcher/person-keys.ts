/**
 * The person's own aliases and keys (betterments.html, "Aliases and
 * per-command keys"): an alias ("ff") names an address and is matched first;
 * a key is a keymap rule whose bind is an address (⌥❖N →
 * dashi://app/dev.dashi.notes/menu/new), put ahead of Dashi's own rules
 * (keymap-state.ts) and sent to the compositor as soon as it is saved.
 * Both live in settings.json under `launcher` (settings-app/store.ts):
 *
 *   "launcher": {
 *     "aliases": { "ff": "dashi://app/org.mozilla.firefox" },
 *     "keys": { "super+alt+n": "dashi://app/dev.dashi.notes/menu/new" }
 *   }
 *
 * The recorder (launcher.tsx, Set shortcut…) hears chords through the keymap
 * (`RECORD_RULES`, while it records) and says what a chord already does
 * before it is kept. Pure, so the tests read it.
 */

import { parseAddress } from "../actions/address.ts";
import { chordGlyphs } from "../actions/keys.ts";
import type { Keymap, Rule } from "../keymap/keymap.ts";
import { fold } from "./ranking/fold.ts";

/** The most aliases and keys the file keeps; more is not a person's list. */
export const MAX_PERSON_ENTRIES = 200;

/** A chord as the binding event reports it (compositor.ts). */
export interface ReportedChord {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

const MODIFIERS = ["super", "ctrl", "alt", "shift"] as const;
const WHEN = /^(?:(?:super|ctrl|alt|shift)\+){1,4}[A-Za-z0-9_]{1,32}$/;

/** A chord a person's key may be: ❖ and a key, with any other modifiers, each once. */
export function isPersonChord(when: unknown): when is string {
  if (typeof when !== "string" || !WHEN.test(when)) return false;
  const mods = when.split("+").slice(0, -1);
  return mods.includes("super") && new Set(mods).size === mods.length;
}

/** An alias: a word or two the person types, short. */
export function isAlias(text: unknown): text is string {
  return typeof text === "string" && text.trim() === text && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u.test(text);
}

const isAddress = (value: unknown): value is string => typeof value === "string" && parseAddress(value) !== null;

/** Whether `value` is an object of at most `MAX_PERSON_ENTRIES` keys that pass `key`, each naming an address. */
function addressMap(value: unknown, key: (text: string) => boolean): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_PERSON_ENTRIES && entries.every(([name, target]) => key(name) && isAddress(target));
}

export const isAliasMap = (value: unknown): value is Record<string, string> => addressMap(value, isAlias);
export const isKeyMap = (value: unknown): value is Record<string, string> => addressMap(value, isPersonChord);

/** The pressed chord as a rule's `when`, ❖ first: "super+alt+n". */
export function chordWhen(chord: ReportedChord): string {
  return [...MODIFIERS.filter((mod) => mod === "super" || chord[mod]), chord.key].join("+");
}

/** The chord as the rows draw it ("⌥❖N"), or the rule text when it has no glyphs. */
export const chordLabel = (when: string): string => chordGlyphs(when) ?? when;

/** While the recorder listens, every ❖ chord is the launcher's: it is told which (the binding's own chord). */
export const RECORD_BINDING = "launcher-record";
export const RECORD_RULES: Rule[] = ["super", "super+ctrl", "super+alt", "super+ctrl+alt"].map((mods) => ({ when: `${mods}+*`, bind: RECORD_BINDING }));

/** The keys the compositor keeps whatever the keymap says (keymap.ts's header). */
function builtIn(mods: ReadonlySet<string>, key: string): boolean {
  if (mods.has("ctrl") && mods.has("alt") && !mods.has("super") && (/^F([1-9]|1[0-2])$/.test(key) || key === "BackSpace")) return true;
  return mods.has("ctrl") && mods.has("super") && key === "Escape";
}

/** Whether `rule` (no app of its own) matches the chord `when`: Super, Ctrl and Alt exactly, Shift only when named. */
function matches(rule: Rule, mods: ReadonlySet<string>, key: string): boolean {
  const parts = rule.when.split("+");
  const ruleKey = parts.pop() ?? "";
  const ruleMods = new Set(parts);
  for (const mod of ["super", "ctrl", "alt"]) if (ruleMods.has(mod) !== mods.has(mod)) return false;
  if (ruleMods.has("shift") && !mods.has("shift")) return false;
  if (ruleKey === "*") return true;
  if (ruleKey === "letter") return /^[a-z]$/i.test(key);
  return ruleKey.split("|").some((name) => name.toLowerCase() === key.toLowerCase());
}

/** What a chord already does, before the person's key takes it. */
export type Collision =
  /** Nothing: free to use (Dashi's ⌃❖ and ⌥❖ are kept free for exactly this). */
  | { kind: "free" }
  /** The compositor keeps it (switching VTs, stopping agents): it can't be a person's key. */
  | { kind: "reserved" }
  /** It does something now; the person's key would take its place. */
  | { kind: "taken"; does: string };

/** The collision of `when` with `keymap`; `describe` names what a bind does ("Lock Screen" for an address). */
export function collision(when: string, keymap: Keymap, describe: (bind: string) => string = (bind) => bind): Collision {
  const parts = when.split("+");
  const key = parts.pop() ?? "";
  const mods = new Set(parts);
  if (builtIn(mods, key)) return { kind: "reserved" };
  for (const rule of keymap.rules) {
    if (rule.app !== undefined || !matches(rule, mods, key)) continue;
    const wildcard = rule.when.endsWith("+*") || rule.when.endsWith("+letter");
    // The catch-alls that swallow are the room kept for these keys.
    if (rule.swallow) return wildcard ? { kind: "free" } : { kind: "taken", does: "nothing, on purpose" };
    if (rule.send) return { kind: "taken", does: wildcard ? "the app's own Ctrl shortcut" : `${rule.send} in apps` };
    if (rule.bind) return { kind: "taken", does: describe(rule.bind) };
    return { kind: "taken", does: "a key of its own" };
  }
  return { kind: "free" };
}

/** The person's keys as keymap rules, in the file's order. */
export function personRules(keys: Readonly<Record<string, string>>): Rule[] {
  return Object.entries(keys)
    .filter(([when, address]) => isPersonChord(when) && isAddress(address))
    .map(([when, bind]) => ({ when, bind }));
}

/** Folded alias → address, for matching what is typed. */
export function aliasIndex(aliases: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(Object.entries(aliases).map(([alias, address]) => [fold(alias), address]));
}

/** `aliases` with `address` given `alias` (one alias per address; an alias names one address), or none. */
export function withAlias(aliases: Readonly<Record<string, string>>, address: string, alias: string | null): Record<string, string> {
  const next = Object.fromEntries(Object.entries(aliases).filter(([name, target]) => target !== address && (alias === null || fold(name) !== fold(alias))));
  if (alias !== null) next[alias] = address;
  return next;
}

/** `keys` with `address` bound to `when` (one key per address; a chord binds one address), or none. */
export function withKey(keys: Readonly<Record<string, string>>, address: string, when: string | null): Record<string, string> {
  const next = Object.fromEntries(Object.entries(keys).filter(([chord, target]) => target !== address && chord !== when));
  if (when !== null) next[when] = address;
  return next;
}

/** The first chord bound to `address`, as glyphs. */
export function keyOf(keys: Readonly<Record<string, string>>, address: string): string | undefined {
  const found = Object.entries(keys).find(([, target]) => target === address);
  return found ? chordLabel(found[0]) : undefined;
}
