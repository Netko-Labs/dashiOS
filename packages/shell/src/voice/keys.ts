/**
 * The talk key: which keys Dashi takes while Voice is on, by evdev code
 * (the compositor's `held-keys`, docs/compositor-ipc.md), and what Settings ›
 * Voice says about each. By default the right ❖ and the Copilot key both
 * talk. Many laptops send the Copilot key as ⇧❖F23, some as F23 alone: the
 * key is taken at its F23 either way. The person may pick another key; one
 * that does something else too says what it stops doing while it talks.
 *
 * A key that can be held is held to talk. The Copilot key often can't be:
 * many laptops send its press and release together, whatever the finger
 * does. So a tap of it starts a listen that ends by itself when the person
 * stops talking, or at the next tap; held, it is a hold like any other.
 */

export type TalkKeyId = "default" | "right-option" | "right-control" | "caps-lock" | "menu";

export interface TalkKey {
  id: TalkKeyId;
  /** In the list: "Right ❖ or Copilot". */
  label: string;
  /** In a sentence: "Hold the right ❖ key". */
  hold: string;
  /** evdev codes (linux/input-event-codes.h). */
  codes: readonly number[];
  /** What the key no longer does while it is the talk key; none for a key with no other use. */
  cost?: string;
  /** How a tap talks, for a key whose tap does (the Copilot key); Settings › Voice says it beside the key. */
  tap?: string;
}

const KEY_RIGHTMETA = 126;
const KEY_F23 = 193;
const KEY_RIGHTALT = 100;
const KEY_RIGHTCTRL = 97;
const KEY_CAPSLOCK = 58;
const KEY_COMPOSE = 127;
const KEY_ESC = 1;

/** The right ❖ and the Copilot key: what talks unless the person picks another. */
const DEFAULT_KEY: TalkKey = {
  id: "default",
  label: "Right ❖ or Copilot",
  hold: "the right ❖ or the Copilot key",
  codes: [KEY_RIGHTMETA, KEY_F23],
  cost: "The right ❖ no longer opens the launcher or makes shortcuts; the left ❖ does.",
  tap: "A Copilot key that can't be held: tap it, talk, then stop talking or tap it again.",
};

export const TALK_KEYS: readonly TalkKey[] = [
  DEFAULT_KEY,
  {
    id: "right-option",
    label: "Right ⌥",
    hold: "the right ⌥ key",
    codes: [KEY_RIGHTALT],
    cost: "The right ⌥ no longer types accents and symbols (AltGr) or makes shortcuts; the left ⌥ still makes shortcuts.",
  },
  {
    id: "right-control",
    label: "Right ⌃",
    hold: "the right ⌃ key",
    codes: [KEY_RIGHTCTRL],
    cost: "The right ⌃ no longer makes shortcuts; the left ⌃ does.",
  },
  { id: "caps-lock", label: "Caps Lock", hold: "Caps Lock", codes: [KEY_CAPSLOCK], cost: "Caps Lock no longer turns capitals on." },
  { id: "menu", label: "Menu key", hold: "the Menu key", codes: [KEY_COMPOSE], cost: "The Menu key no longer opens an app's context menu." },
];

export const isTalkKeyId = (value: unknown): value is TalkKeyId => TALK_KEYS.some((key) => key.id === value);

export function talkKey(id: TalkKeyId | undefined): TalkKey {
  return TALK_KEYS.find((key) => key.id === id) ?? DEFAULT_KEY;
}

/** The names the compositor's `held-key` events carry: a key held to talk, the Copilot key (a tap of it talks too), and Esc. */
export const TALK = "talk";
export const TALK_TAP = "talk-tap";
export const STOP = "stop";

/** Whether a `held-key` name is a talk key's. */
export const talks = (name: string): boolean => name === TALK || name === TALK_TAP;

/** What `held-keys` is sent: the talk key while Voice is on (the Copilot key under its own name), and Esc (alone, never a chord) while there is something to stop. */
export function heldKeys(key: TalkKey | null, stoppable: boolean): Array<{ name: string; code: number; bare?: boolean }> {
  const talk = key ? key.codes.map((code) => ({ name: code === KEY_F23 ? TALK_TAP : TALK, code })) : [];
  return [...talk, ...(stoppable ? [{ name: STOP, code: KEY_ESC, bare: true }] : [])];
}

/** After a tap of the Copilot key: a quiet this long ends the listen, and with nothing heard at all it gives up after this long. */
export const TAP_QUIET_MS = 1500;
export const TAP_WAIT_MS = 8000;

/** A press shorter than this is a tap: it stops Dashi if it was speaking, and otherwise says how to talk. */
export const TAP_MS = 300;

/** A voice's id as the service names them ("af_heart", "bm_george"). */
export const isVoiceId = (value: unknown): value is string => typeof value === "string" && /^[a-z]{2}_[a-z]{1,24}$/.test(value);
