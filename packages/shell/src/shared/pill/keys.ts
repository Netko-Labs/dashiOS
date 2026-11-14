/**
 * The two keys (docs/night-0.9-contract.md, "core"): the Dashi key and the
 * dictation key, and what a press of one turned out to be. The core piece
 * works the gestures out from the compositor's key events and tells them
 * here; the capsule and the bar only read them.
 */

/** Which key: the Dashi key (❖Space kept down, or the Copilot key) or the dictation key (right ⌥ or Caps Lock, held alone). */
export type PillKey = "dashi" | "dictation";

/**
 * - `down`: the key went down. Nothing is known yet; the capsule may show its key-down frame.
 * - `hold`: it stayed down `HOLD_MS` with no other key: a hold. The listen is open.
 * - `up`: a hold ended.
 * - `tap`: it came up before `HOLD_MS`. Sent as the key comes up, never earlier.
 * - `double-tap`: a second press within `DOUBLE_MS` of a tap's end (the dictation key only: hands-free).
 * - `chord`: another key went down while it was held, so it was a modifier after all (AltGr, ❖Space then a letter). Whatever `down` showed goes away; nothing was heard.
 */
export type KeyGestureKind = "down" | "hold" | "up" | "tap" | "double-tap" | "chord";

export interface KeyGesture {
  key: PillKey;
  gesture: KeyGestureKind;
  /** The shell's clock, in ms. */
  at: number;
}

/** A press shorter than this is a tap (0.8's `TAP_MS`). */
export const HOLD_MS = 300;
/** A second press this soon after a tap is a double tap. */
export const DOUBLE_MS = 350;

/** The dictation key the person may pick (settings.json `dictation.key`); `auto` is right ⌥, or Caps Lock where the layout uses right ⌥ as AltGr. */
export const DICTATION_KEYS = ["auto", "right-option", "caps-lock", "right-control", "menu"] as const;
export type DictationKeyId = (typeof DICTATION_KEYS)[number];
export const isDictationKeyId = (value: unknown): value is DictationKeyId => DICTATION_KEYS.some((key) => key === value);
