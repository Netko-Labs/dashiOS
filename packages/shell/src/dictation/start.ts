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
  /** A tap of the Dashi key with no card up: the launcher, as ❖Space always did. */
  launcher(): void;
}

export interface DictationParts {
  dictation: Dictation;
  /** A `held-key` event of the compositor's. `talk` says one of 0.8's talk keys moved: the capsule is told, Voice hears it itself. */
  key(name: string, down: boolean, chord?: boolean): void;
  /** The key that dictates now, or null while dictation is off. */
  dictationKey(): DictationKey | null;
  close(): void;
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

  let listening = false;
  const dashi = (gesture: KeyGesture): void => {
    hub.keys.send(gesture);
    switch (gesture.gesture) {
      case "hold":
        listening = true;
        return options.voice.hold();
      case "up":
        listening = false;
        return options.voice.release();
      case "chord":
        if (listening) options.voice.stop();
        listening = false;
        return;
      case "tap":
        // While a card is up the capsule gives it the keyboard; core does nothing more.
        if (hub.asks.getSnapshot().length === 0) options.launcher();
        return;
      default:
        return;
    }
  };
  const gestures = {
    [DASHI]: new KeyGestures("dashi", { timers, now, tell: dashi }),
    [DICTATION]: new KeyGestures("dictation", {
      timers,
      now,
      doubles: true,
      tell: (gesture) => {
        hub.keys.send(gesture);
        dictation.gesture(gesture);
      },
    }),
    // 0.8's talk keys (the Copilot key, a key the person chose): the capsule sees them as the Dashi key.
    talk: new KeyGestures("dashi", { timers, now, tell: (gesture) => void hub.keys.send(gesture) }),
  };

  let sent = "";
  const sync = (): void => {
    const { voiceOn } = options.settings();
    const keys = pillHeldKeys({ dashi: voiceOn, dictation: chosen() });
    const text = JSON.stringify(keys);
    if (text === sent) return;
    sent = text;
    options.hold(keys);
    if (!prefs().on) dictation.stop();
  };
  const off = options.subscribe(sync);
  sync();

  return {
    dictation,
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
