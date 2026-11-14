/** What dictation is given (start.ts, boot/dictation.ts): the service that hears, the window in front, and how words reach it. */

import type { DictationTrouble, PillHub } from "../shared/pill/index.ts";
import type { Timers } from "../shared/time/index.ts";

/** dashi-voice, as dictation uses it (voice/'s service). */
export interface Hearing {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(listener: (event: HearingEvent) => void): () => void;
}

/** The events dictation reads; the others pass by. */
export type HearingEvent =
  | { event: "level"; level: number }
  | { event: "partial"; text: string }
  | { event: "heard"; text: string }
  | { event: "error"; message: string }
  | { event: string };

/** The window that has the keyboard. */
export interface Front {
  window: number;
  pid: number | null;
}

export interface DictationPrefs {
  /** Voice is on and dictation is not turned off. */
  on: boolean;
  tidy: boolean;
  handsFree: boolean;
  /** What Dashi is called (the persona's). */
  name: string;
}

export interface DictationDeps {
  hub: PillHub;
  service: Hearing;
  prefs(): DictationPrefs;
  /** What stops the service from hearing now (its models, the service itself), or null. */
  trouble(): DictationTrouble | null;
  /** Dashi itself is listening or speaking. */
  busy(): boolean;
  /** Whether the microphone is muted; false when it can't be told. */
  muted(): Promise<boolean>;
  /** The window with the keyboard, or null when none has it (the desktop). */
  front(): Promise<Front | null>;
  /** Whether a password field has the keyboard there; null when it can't be told. */
  secret(front: Front): Promise<boolean | null>;
  /** Type into the window (the compositor's `type-text`); rejects with its refusal. */
  typeText(window: number, text: string): Promise<void>;
  /** The honest fallback: through the clipboard, which is put back; whether it pasted. */
  paste(window: number, text: string): Promise<boolean>;
  copy(text: string): Promise<boolean>;
  /** The short sound of hands-free ending. */
  chime(): void;
  /** Whether the key was taught already, and that it was now. */
  taught(): boolean;
  teach(): void;
  /** The session's locale, for a language only Whisper hears. */
  language?: string | undefined;
  timers?: Timers;
  now?(): number;
}
