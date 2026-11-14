/**
 * The hub the four night-build pieces meet at (docs/night-0.9-contract.md):
 * one object, made once at start (main.tsx), holding what each piece
 * tells the others. A piece sets only what it owns and reads the rest; none
 * imports another piece.
 *
 * - `Cell`: one value at a time, read with `getSnapshot` and `subscribe`
 *   (React's `useSyncExternalStore` takes them as they are).
 * - `Port`: messages to whoever handles them. Until its owner calls
 *   `handle`, a message is dropped and `send` says so.
 */

import type { BarCommand, BarRowState } from "./bar.ts";
import type { DictationCommand, DictationState } from "./dictation.ts";
import type { KeyGesture } from "./keys.ts";
import { DEFAULT_PERSONA, type Persona } from "./persona.ts";
import type { PillAsk, VoiceModeCommand, VoiceModeState } from "./voice-mode.ts";

export interface Cell<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  /** The owner's alone. */
  set(value: T): void;
}

export interface Port<M> {
  /** False when nobody handles it yet. */
  send(message: M): boolean;
  /** The owner's alone: takes the messages from now on; the returned function stops it. */
  handle(handler: (message: M) => void): () => void;
  /** Anyone: hears each message as it is sent, handled or not. */
  listen(listener: (message: M) => void): () => void;
}

export function cell<T>(first: T): Cell<T> {
  let value = first;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function port<M>(): Port<M> {
  let handler: ((message: M) => void) | null = null;
  const listeners = new Set<(message: M) => void>();
  return {
    send(message) {
      for (const listener of [...listeners]) listener(message);
      if (!handler) return false;
      handler(message);
      return true;
    },
    handle(next) {
      handler = next;
      return () => {
        if (handler === next) handler = null;
      };
    },
    listen(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export interface PillHub {
  /** core tells: what each press of the two keys was. */
  keys: Port<KeyGesture>;
  /** core sets; the capsule draws. */
  dictation: Cell<DictationState>;
  /** The microphone's level, 0 to 1, about 31 times a second while anything listens. core sets it for dictation, the capsule's adapter for voice mode. */
  level: Cell<number>;
  /** The capsule sends; core handles. */
  dictationCommands: Port<DictationCommand>;
  /** The capsule piece's adapter over 0.8's voice loop sets; the capsule draws, the bar reads. */
  voiceMode: Cell<VoiceModeState>;
  /** The capsule piece sets, the oldest first; it shows the first as the card, the bar counts them, core looks before a tap opens the launcher. */
  asks: Cell<readonly PillAsk[]>;
  /** The capsule and the bar send; the capsule piece handles. */
  voiceCommands: Port<VoiceModeCommand>;
  /** The bar sets. */
  bar: Cell<BarRowState>;
  /** core and the capsule send; the bar handles. */
  barCommands: Port<BarCommand>;
  /** The persona piece sets; everyone reads. */
  persona: Cell<Persona>;
}

export function createPillHub(): PillHub {
  return {
    keys: port(),
    dictation: cell<DictationState>({ phase: "idle" }),
    level: cell(0),
    dictationCommands: port(),
    voiceMode: cell<VoiceModeState>({ phase: "idle" }),
    asks: cell<readonly PillAsk[]>([]),
    voiceCommands: port(),
    bar: cell<BarRowState>({ mode: "rest" }),
    barCommands: port(),
    persona: cell(DEFAULT_PERSONA),
  };
}
