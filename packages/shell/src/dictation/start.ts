/**
 * Dictation and the two keys, put together (boot/dictation.ts starts it):
 * the compositor's `held-key` events become gestures told on the hub
 * (`hub.keys`); the dictation key's drive dictation; the Dashi key's hold is
 * 0.8's listen, and its tap opens the launcher on release, unless a card
 * waits for the keyboard (`hub.asks`). Which keys, and whether any, follows
 * the settings live.
 */

import type { DictationKeyId, KeyGesture } from "../shared/pill/index.ts";
import { realTimers } from "../shared/time/index.ts";
import { Dictation } from "./dictation.ts";
import type { DictationHistory } from "./history.ts";
import { DASHI, DICTATION, type DictationKey, dictationKey, type Layout, type PillHeldKey, pillHeldKeys } from "./keys.ts";
import { KeyGestures } from "./lib/gestures.ts";
import type { DictationDeps } from "./types.ts";

export interface DictationOptions extends Omit<DictationDeps, "prefs"> {
  /** settings.json, as it is now. */
  settings(): { voiceOn: boolean; on: boolean; key: DictationKeyId | undefined; handsFree: boolean; tidy: boolean; layout: Layout };
  subscribe(listener: () => void): () => void;
  /** The evdev codes of the keys that already talk to Dashi (the person's 0.8 choice). */
  talkCodes(): readonly number[];
  /** The compositor's `held-keys`, the two keys' part. */
  hold(keys: PillHeldKey[]): void;
  /** Dashi's own listen (voice/voice.ts): the Dashi key became a hold, came up, or was a chord after all. */
  voice: { hold(): void; release(): void; stop(): void };
  /** A tap of the Dashi key: the launcher, as ❖Space always did, unless a card is on screen (it takes the keyboard). */
  launcher(): void;
}

export interface DictationParts {
  dictation: Dictation;
  /** What was dictated, for Settings › Voice › Dictation; null where none is kept. */
  history: DictationHistory | null;
  /** A `held-key` event of the compositor's. `talk` says one of 0.8's talk keys moved: the capsule is told, Voice hears it itself. */
  key(name: string, down: boolean, chord?: boolean): void;
  /** The key that dictates now, or null while dictation is off. */
  dictationKey(): DictationKey | null;
  close(): void;
}

/**
 * "Type it instead" may land what is said to Dashi: the field check is warmed at the Dashi key's hold, as a dictation's
 * own hold warms it, so the first one of a session does not wait on a cold accessibility bus (decisions.md D122).
 */
function warmFieldCheck(options: DictationOptions): void {
  void options
    .front()
    .then((front) => (front ? options.secret(front) : null))
    .catch(() => {});
}

/** What the Dashi key's gestures do: a hold is 0.8's listen, a tap the launcher; every one is told on the hub. */
function dashiKey(options: DictationOptions): (gesture: KeyGesture) => void {
  const { hub } = options;
  let listening = false;
  return (gesture: KeyGesture): void => {
    hub.keys.send(gesture);
    switch (gesture.gesture) {
      case "hold":
        listening = true;
        warmFieldCheck(options);
        return options.voice.hold();
      case "up":
        listening = false;
        return options.voice.release();
      case "chord":
        if (listening) options.voice.stop();
        listening = false;
        return;
      case "tap":
        // The launcher, unless a card on screen takes the tap (boot/dictation.ts asks the capsule).
        return options.launcher();
      default:
        return;
    }
  };
}

export function startDictation(options: DictationOptions): DictationParts {
  const timers = options.timers ?? realTimers;
  const now = options.now ?? (() => Date.now());
  const { hub } = options;
  const prefs: DictationDeps["prefs"] = () => {
    const { voiceOn, on, handsFree, tidy } = options.settings();
    return { on: voiceOn && on, tidy, handsFree, name: hub.persona.getSnapshot().name };
  };
  const dictation = new Dictation({ ...options, prefs, timers, now });
  const chosen = (): DictationKey | null => {
    const { voiceOn, on, key, layout } = options.settings();
    return voiceOn && on ? dictationKey(key, layout, options.talkCodes()) : null;
  };

  // Voice is off and dictation is asked for: its key is still heard, until a hold of it has been told what
  // dictation needs, once a session (D116). Only a key that is heard and not taken (a modifier, held alone):
  // Caps Lock and the Menu key stay the person's while Voice is off.
  let told = false;
  const teaching = (): DictationKey | null => {
    const { voiceOn, on, key, layout } = options.settings();
    if (told || voiceOn || !on) return null;
    const would = dictationKey(key, layout, options.talkCodes());
    return would.modifier ? would : null;
  };

  const dashi = dashiKey(options);
  const gestures = {
    [DASHI]: new KeyGestures("dashi", { timers, now, tell: dashi }),
    [DICTATION]: new KeyGestures("dictation", {
      timers,
      now,
      doubles: true,
      tell: (gesture) => {
        if (teaching()) {
          if (gesture.gesture !== "hold") return;
          told = true;
          // The key is let go of first (that stops dictation, which has nothing on), then the line shows.
          sync();
          return dictation.needsVoice();
        }
        hub.keys.send(gesture);
        dictation.gesture(gesture);
      },
    }),
    // 0.8's talk keys (the Copilot key, a key the person chose): the capsule sees them as the Dashi key.
    talk: new KeyGestures("dashi", { timers, now, tell: (gesture) => void hub.keys.send(gesture) }),
  };

  let sent = "";
  function sync(): void {
    const { voiceOn } = options.settings();
    const keys = pillHeldKeys({ dashi: voiceOn, dictation: chosen() ?? teaching() });
    const text = JSON.stringify(keys);
    if (text === sent) return;
    sent = text;
    options.hold(keys);
    if (!prefs().on) dictation.stop();
  }
  const off = options.subscribe(sync);
  sync();

  return {
    dictation,
    history: options.history ?? null,
    key(name, down, chord = false) {
      const which = name === DASHI ? gestures[DASHI] : name === DICTATION ? gestures[DICTATION] : gestures.talk;
      if (down) which.down();
      else which.up(chord);
    },
    dictationKey: chosen,
    close() {
      off();
      dictation.close();
    },
  };
}
