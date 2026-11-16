/** What dictation is given (start.ts, boot/dictation.ts): the service that hears, the window in front, and how words reach it. */

import type { Rewriter } from "../rewrite/index.ts";
import type { DictationTrouble, PillHub } from "../shared/pill/index.ts";
import type { Timers } from "../shared/time/index.ts";
import type { DictationHistory } from "./history.ts";
import type { Lexicon } from "./lexicon.ts";
import type { Words } from "./words.ts";

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
  /** The app the window is (its `app_id`) and its title, where the compositor says. */
  appId?: string | undefined;
  title?: string | undefined;
}

/** A word dictation writes the person's way, and what the recogniser tends to hear instead. */
export interface Term {
  term: string;
  heard: string[];
}

/** What was heard, and what is typed for it (a replacement, a snippet). */
export interface Pair {
  from: string;
  to: string;
}

/** How dictation behaves in one kind of place (`~/.config/dashi/dictation/profiles/<id>`; lib/profiles.ts has Dashi's own five). */
export interface Profile {
  id: string;
  /** What the capsule and Settings call it. */
  name: string;
  /** The apps it is for (parts of an app id, lower case) and the sites (a host and its subdomains). */
  apps: string[];
  sites: string[];
  /** One short sentence for the correction model. */
  tone: string;
  /** The model is asked for every utterance, not only where the gate thinks it is needed. */
  polish: boolean;
  /** False: nothing is changed but spacing (Verbatim). */
  tidy: boolean;
  /** A sentence starts with a capital. */
  capitals: boolean;
  /** The full stop at the very end: kept, dropped, or dropped when one sentence is all there is. */
  period: "keep" | "drop" | "drop-single";
  /** A line break is Return (`hard`), or ⇧Return where Return sends (`soft`). */
  breaks: "hard" | "soft";
  lists: "markdown" | "plain";
  /** Casing and symbols by voice, and backticks around identifiers. */
  code: boolean;
  /** A line break after an opening "Hi Alex,". */
  greeting: boolean;
  words: string[];
  replacements: Pair[];
}

/** The field that has the keyboard, as far as AT-SPI tells (clipboard/lib/fields.ts). */
export interface FieldRead {
  kind: "password" | "text" | "other";
  /** What sort of field: a terminal, a one-line entry, a larger text, or something else. */
  role: "terminal" | "entry" | "text" | "other";
  /** The site of the web page it is in (its host), or null outside a page. */
  site: string | null;
  /** The text before and after the caret (the last and next few hundred characters); null where the field can't be read. */
  before: string | null;
  after: string | null;
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
  /** The field with the keyboard there: what it is and the text around its caret; null when it can't be told. */
  field(front: Front): Promise<FieldRead | null>;
  /** One chord into the window (the compositor's `send-keys`): BackSpace for Undo where `type-text` can't be used (an X11 window). */
  sendKeys(window: number, chord: string): Promise<void>;
  /** The app a window is, by the name the person knows ("Text Editor"); "" when not known. */
  appName?(front: Front): string;
  /** Whether an agent's prompt (Claude Code, Codex) runs in the terminal in front, not a bare shell (lib/terminal.ts). */
  terminalAgent?(front: Front): Promise<boolean>;
  /** The person's vocabulary, replacements, snippets and profiles (lexicon.ts); Dashi's own, unseeded, where none is given. */
  lexicon?: Lexicon | undefined;
  /** Which words are words (lib/words.ts); none where no dictionary is given. */
  words?: Words | undefined;
  /** The model that corrects a transcript (docs/dictation-rewrite.md); the rules alone where none is given. */
  rewriter?: Rewriter | undefined;
  /** What was dictated, kept on disk for the history (lib/history.ts); none in a test that needs none. */
  history?: DictationHistory | undefined;
  /**
   * How long ago (ms) the person's own hands last pressed a button or a key in the window (the compositor's
   * `input-origin`); null when not within the last minute, or when it can't be told.
   */
  pressed(window: number): Promise<number | null>;
  /**
   * Type into the window (the compositor's `type-text`); rejects with its refusal. `erase`: that many BackSpaces first.
   * `breaks`: the chord a line break is typed as where Return sends ("shift+Return"). Both ride with the text because
   * only so do they reach the window in order: a `send-keys` chord goes through the input method and arrives later.
   */
  typeText(window: number, text: string, how?: { erase?: number; breaks?: string }): Promise<void>;
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
