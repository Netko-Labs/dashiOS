/**
 * The two keys, as the compositor is asked to hear them (`held-keys`,
 * docs/compositor-ipc.md): the Dashi key is ❖Space, and the dictation key
 * is the right ⌥ held alone, or Caps Lock where the layout makes the right
 * ⌥ AltGr (it types accents there, and holding it must stay that). The
 * person may pick the dictation key (settings.json `dictation.key`).
 */

import { type DictationKeyId, HOLD_MS } from "../shared/pill/index.ts";

/** The names the compositor's `held-key` events carry. */
export const DASHI = "dashi";
export const DICTATION = "dictation";

const KEY_SPACE = 57;
const KEY_CAPSLOCK = 58;
const KEY_RIGHTCTRL = 97;
const KEY_RIGHTALT = 100;
const KEY_COMPOSE = 127;

export interface PillHeldKey {
  name: string;
  code: number;
  alone?: true;
  super?: true;
  tapMs?: number;
}

export type ChosenKey = Exclude<DictationKeyId, "auto">;

export interface DictationKey {
  id: ChosenKey;
  /** In a sentence: "Hold the right ⌥ key". */
  hold: string;
  code: number;
  /** A modifier: heard, and still the app's (a chord with it is not dictation). */
  modifier: boolean;
}

const KEYS: Readonly<Record<ChosenKey, DictationKey>> = {
  "right-option": { id: "right-option", hold: "the right ⌥ key", code: KEY_RIGHTALT, modifier: true },
  "caps-lock": { id: "caps-lock", hold: "Caps Lock", code: KEY_CAPSLOCK, modifier: false },
  "right-control": { id: "right-control", hold: "the right ⌃ key", code: KEY_RIGHTCTRL, modifier: true },
  menu: { id: "menu", hold: "the Menu key", code: KEY_COMPOSE, modifier: false },
};

/** What the choices are called in Settings › Voice. */
export const DICTATION_KEY_LABELS: Readonly<Record<DictationKeyId, string>> = {
  auto: "Automatic",
  "right-option": "Right ⌥",
  "caps-lock": "Caps Lock",
  "right-control": "Right ⌃",
  menu: "Menu key",
};

export interface Layout {
  layout?: string | undefined;
  variant?: string | undefined;
}

/**
 * Whether the right ⌥ is AltGr on this layout. Only the plain US layouts
 * leave it a second ⌥; Spanish, US International and most others type
 * accents and symbols with it. A layout not known is taken as plain.
 */
export function usesAltGr({ layout, variant }: Layout): boolean {
  const first = layout?.split(",")[0]?.trim() ?? "";
  const kind = variant?.split(",")[0]?.trim() ?? "";
  if (first === "") return false;
  return !(first === "us" && (kind === "" || kind.startsWith("dvorak")));
}

/** The key that dictates: the one chosen, or by the layout; never a key that already talks to Dashi (`taken`, evdev codes). */
export function dictationKey(chosen: DictationKeyId | undefined, layout: Layout, taken: readonly number[] = []): DictationKey {
  if (chosen && chosen !== "auto") return KEYS[chosen];
  const order: ChosenKey[] = usesAltGr(layout) ? ["caps-lock", "right-control"] : ["right-option", "caps-lock", "right-control"];
  const free = order.find((id) => !taken.includes(KEYS[id].code));
  return KEYS[free ?? "caps-lock"];
}

/** What `held-keys` is sent for the two keys. */
export function pillHeldKeys(options: { dashi: boolean; dictation: DictationKey | null }): PillHeldKey[] {
  const keys: PillHeldKey[] = [];
  if (options.dashi) keys.push({ name: DASHI, code: KEY_SPACE, super: true, tapMs: HOLD_MS });
  const key = options.dictation;
  if (key) keys.push({ name: DICTATION, code: key.code, ...(key.modifier ? { alone: true as const } : {}) });
  return keys;
}
