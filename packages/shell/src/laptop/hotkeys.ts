/**
 * The laptop's own keys (docs/0.4.0.html, ASUS support D): Fn F5 for the
 * mode, Fn F4 for the keyboard light, the ROG key, and mic mute, as Dashi
 * actions with the on-screen display. Which kernel key each one sends comes
 * from the model database (`Describe().hotkeys`, `KEY_PROG3`); the
 * compositor matches xkb keysyms, so each is named the way xkeyboard-config's
 * evdev map names that key. A key the map has no keysym for has no rule.
 *
 * On the G14 the firmware handles Fn F5 itself (asus-wmi cycles the platform
 * profile and sends no key); dashi-hardware's `Changed` brings that one to
 * the mode store instead (power/modes/store.ts).
 */

import type { Hotkeys } from "../hardware/describe.ts";
import type { Rule } from "../keymap.ts";
import type { ModeStore } from "../power/modes/store.ts";
import type { OsdController } from "../system/osd-state.ts";
import { keyboardLight, type LaptopStore } from "./store.ts";

/** Kernel key names (linux/input-event-codes.h) to xkb keysyms (xkeyboard-config's evdev keycodes, symbols/inet). */
export const KERNEL_KEYSYMS: Readonly<Record<string, string>> = {
  KEY_PROG1: "XF86Launch1",
  KEY_PROG2: "XF86Launch2",
  KEY_PROG3: "XF86Launch3",
  KEY_PROG4: "XF86Launch4",
  KEY_KBDILLUMTOGGLE: "XF86KbdLightOnOff",
  KEY_KBDILLUMUP: "XF86KbdBrightnessUp",
  KEY_KBDILLUMDOWN: "XF86KbdBrightnessDown",
  KEY_MICMUTE: "XF86AudioMicMute",
  KEY_BATTERY: "XF86Battery",
  KEY_CONFIG: "XF86Tools",
  KEY_FAVORITES: "XF86Favorites",
};

/** The shell's binding names for the laptop's keys (shortcuts.ts hands them to the laptop). */
export const LAPTOP_BINDINGS = {
  mode: "laptop-mode",
  lighting: "laptop-light",
  rog: "laptop-rog",
  // Mic mute is already a hardware key (system/keys.ts).
  micMute: "mic-mute",
} as const satisfies Record<keyof Hotkeys, string>;

/** The keyboard light's step keys, bound wherever there is a light to step. */
export const LIGHT_STEP_BINDINGS = { up: "laptop-light-up", down: "laptop-light-down" } as const;

export const LAPTOP_BINDING_NAMES: ReadonlySet<string> = new Set([
  LAPTOP_BINDINGS.mode,
  LAPTOP_BINDINGS.lighting,
  LAPTOP_BINDINGS.rog,
  LIGHT_STEP_BINDINGS.up,
  LIGHT_STEP_BINDINGS.down,
]);

/** The keymap rules for this machine's keys. */
export function laptopKeyRules(hotkeys: Hotkeys, hasKeyboardLight: boolean): Rule[] {
  const rules: Rule[] = [];
  const seen = new Set<string>();
  const add = (keysym: string | undefined, bind: string) => {
    if (keysym === undefined || seen.has(keysym)) return;
    seen.add(keysym);
    rules.push({ when: keysym, bind });
  };
  for (const role of ["mode", "lighting", "rog", "micMute"] as const) {
    const key = hotkeys[role];
    if (role === "lighting" && !hasKeyboardLight) continue;
    add(key === undefined ? undefined : KERNEL_KEYSYMS[key], LAPTOP_BINDINGS[role]);
  }
  if (hasKeyboardLight) {
    add("XF86KbdBrightnessUp", LIGHT_STEP_BINDINGS.up);
    add("XF86KbdBrightnessDown", LIGHT_STEP_BINDINGS.down);
    add("XF86KbdLightOnOff", LAPTOP_BINDINGS.lighting);
  }
  return rules;
}

/** The keyboard light's next level for a press: up through the levels, then off. */
export function nextLightLevel(level: number, max: number, step: "cycle" | "up" | "down"): number {
  if (max <= 0) return 0;
  if (step === "up") return Math.min(max, level + 1);
  if (step === "down") return Math.max(0, level - 1);
  return level >= max ? 0 : level + 1;
}

/** The keyboard light: set to a level (0 is off), or stepped through its cycle with the on-screen display. */
export function keyboardLights(store: LaptopStore, osd: OsdController): { setLight(level: number): void; stepLight(step: "cycle" | "up" | "down"): void } {
  const setLight = (level: number) => {
    const light = keyboardLight(store.getSnapshot());
    if (!light) return;
    const next = Math.max(0, Math.min(light.max, Math.round(level)));
    void store.set("kbd-backlight", next);
  };
  const stepLight = (step: "cycle" | "up" | "down") => {
    const light = keyboardLight(store.getSnapshot());
    if (!light) return;
    const next = nextLightLevel(light.level, light.max, step);
    setLight(next);
    osd.show({ kind: "keyboard-light", level: next, max: light.max });
  };
  return { setLight, stepLight };
}

/** The laptop's keys the compositor reports: the mode, the light, the ROG key. Resolves to whether one was ours. */
export function machineKeyHandler(parts: {
  modes: ModeStore;
  stepLight(step: "cycle" | "up" | "down"): void;
  openSettings(pane: "battery"): void;
}): (name: string) => Promise<boolean> {
  return async (name) => {
    if (!LAPTOP_BINDING_NAMES.has(name)) return false;
    if (name === LAPTOP_BINDINGS.mode) parts.modes.cycle();
    else if (name === LAPTOP_BINDINGS.lighting) parts.stepLight("cycle");
    else if (name === LIGHT_STEP_BINDINGS.up) parts.stepLight("up");
    else if (name === LIGHT_STEP_BINDINGS.down) parts.stepLight("down");
    else if (name === LAPTOP_BINDINGS.rog) parts.openSettings("battery");
    return true;
  };
}
