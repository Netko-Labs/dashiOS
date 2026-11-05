/**
 * The keymap the compositor should have now: Dashi's own (keymap.ts) with this
 * machine's rules first (the laptop's keys, laptop/hotkeys.ts). Anything that
 * sends a keymap for a while (the app switcher's session) builds on this one
 * and goes back to it, so the laptop's keys survive the switcher.
 */

import { KEYMAP, type Keymap, type Rule, withRules } from "./keymap.ts";

let machineRules: readonly Rule[] = [];

/** This machine's own rules; the next `currentKeymap()` puts them first. */
export function setMachineRules(rules: readonly Rule[]): void {
  machineRules = rules;
}

/** Dashi's keymap with this machine's rules. */
export function currentKeymap(): Keymap {
  return withRules(KEYMAP, machineRules);
}
