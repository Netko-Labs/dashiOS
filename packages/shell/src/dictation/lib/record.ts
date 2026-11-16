/**
 * The insertion record (docs/voice.md, "The insertion record"): what Dashi
 * typed, where and when, the newest last. Undo, "scratch that", Raw and
 * "paste last" act on it and on nothing else: Dashi never reasons about
 * text it did not write. In memory only; the history on disk (history.ts)
 * keeps the words, not where they went.
 */

export interface Insertion {
  id: string;
  at: number;
  window: number;
  pid: number | null;
  /** The app's name ("Text Editor"), "" when not known; and the field, as far as AT-SPI told ("terminal", "entry on github.com"). */
  app: string;
  field: string;
  /** The recogniser's words, and the words that landed. */
  heard: string;
  text: string;
  /** Exactly the characters sent to the field, the space before and after them included: what Undo takes back. */
  typed: string;
  how: "typed" | "pasted";
  /** The profile that tidied it. */
  profile: string;
  /** The field's text could be read when it landed, so Undo can check it is still there. */
  readable: boolean;
  /** The chord its line breaks were typed as where Return sends (⇧Return, ⌃J); null where they were Return. */
  breaks: string | null;
}

/** How many are remembered. */
const MOST = 40;

let serial = 0;
/** An id no other insertion of this session has. */
export const insertionId = (now: number): string => `${now.toString(36)}-${(serial++).toString(36)}`;

export class Insertions {
  private readonly stack: Insertion[] = [];

  push(entry: Insertion): void {
    this.stack.push(entry);
    if (this.stack.length > MOST) this.stack.shift();
  }

  /** The newest, in `window` when one is named. */
  top(window?: number): Insertion | null {
    for (let at = this.stack.length - 1; at >= 0; at--) {
      const entry = this.stack[at];
      if (entry && (window === undefined || entry.window === window)) return entry;
    }
    return null;
  }

  get(id: string): Insertion | null {
    return this.stack.find((entry) => entry.id === id) ?? null;
  }

  /** It is no longer Dashi's to take back (taken back already, or the field moved on). */
  drop(id: string): void {
    const at = this.stack.findIndex((entry) => entry.id === id);
    if (at >= 0) this.stack.splice(at, 1);
  }

  clear(): void {
    this.stack.length = 0;
  }
}
