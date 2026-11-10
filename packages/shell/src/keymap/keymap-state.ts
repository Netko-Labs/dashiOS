/**
 * The keymap the compositor should have now: Dashi's own (keymap.ts) with
 * this machine's rules first (the laptop's keys, laptop/lib/hotkeys.ts), and the
 * person's own keys before those (launcher/person-keys.ts: a chord bound to
 * a `dashi://` address from the launcher's Set shortcut…). Anything that
 * sends a keymap for a while (the app switcher's session, the launcher)
 * builds on this one and goes back to it, so these keys survive it.
 */

import { withTypeAheadOnTap } from "../launcher/type-ahead.ts";
import { KEYMAP, type Keymap, type Rule, withRules } from "./keymap.ts";

let machineRules: readonly Rule[] = [];
let personRules: readonly Rule[] = [];

/** This machine's own rules; the next `currentKeymap()` puts them first. */
export function setMachineRules(rules: readonly Rule[]): void {
  machineRules = rules;
}

/** The person's own keys; the next `currentKeymap()` puts them before everything else. */
export function setPersonRules(rules: readonly Rule[]): void {
  personRules = rules;
}

/** Dashi's keymap with this machine's rules and the person's keys. */
export function currentKeymap(): Keymap {
  return withRules(KEYMAP, [...personRules, ...machineRules]);
}

/** The keymap while nothing holds the keys: the current one, and the launcher's typing from a ❖ tap on. */
export function idleKeymap(): Keymap {
  return withTypeAheadOnTap(currentKeymap());
}
