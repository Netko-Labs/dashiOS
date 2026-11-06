/**
 * No key typed after a ❖ tap is lost. From the tap until the launcher's
 * field has the keyboard (its surface drew its first frame), what is typed
 * is the shell's: the compositor switches to the idle keymap's `afterTap`
 * rules the instant ❖ is tapped (docs/compositor-ipc.md, `keymap`), whose
 * last rule takes every plain key as a `launcher-type` binding with the text
 * it typed. The keys wait here, in order, and go to the launcher once it is
 * up; from then on its field takes them, and a key that was already on its
 * way here still goes to the launcher, after the others.
 *
 * Chords with ❖, Ctrl or Alt are not typing and keep their meaning, as do
 * the session's own rules (the volume keys), which come before the catch-all.
 */

import type { Keymap, Rule } from "../keymap.ts";
import { LAUNCHER_RULES } from "./keys.ts";

export const TYPE_BINDING = "launcher-type";

/** Everything else a plain key does, it types into the launcher. */
const TYPE_RULE: Rule = { when: "*", bind: TYPE_BINDING };

/** The keys typed ahead that mean something to the launcher besides text. */
export type TypedKey = "BackSpace" | "Return" | "Escape" | "Up" | "Down";

export type Typed = { kind: "text"; text: string } | { kind: "key"; key: TypedKey };

/** Keysym names (xkb's) to those keys. */
const KEYS: ReadonlyMap<string, TypedKey> = new Map([
  ["BackSpace", "BackSpace"],
  ["Return", "Return"],
  ["KP_Enter", "Return"],
  ["Escape", "Escape"],
  ["Up", "Up"],
  ["KP_Up", "Up"],
  ["Down", "Down"],
  ["KP_Down", "Down"],
]);

/** A `launcher-type` binding as typing; null for a key that types nothing the launcher uses (Tab, F5). */
export function typedFrom(binding: { key: string; text?: string }): Typed | null {
  const key = KEYS.get(binding.key);
  if (key) return { kind: "key", key };
  return binding.text ? { kind: "text", text: binding.text } : null;
}

/** While the launcher waits for its surface: its keys, the session's, then every other plain key is typing. */
export const withTyping = (keymap: Keymap): Keymap => ({ ...keymap, rules: [...LAUNCHER_RULES, ...keymap.rules, TYPE_RULE] });

/** The keymap while the launcher is closed: as it is, and typing from the instant of a ❖ tap. */
export const withTypeAheadOnTap = (keymap: Keymap): Keymap => ({ ...keymap, afterTap: withTyping(keymap).rules });

/** `query` after text and BackSpaces typed ahead, in order (BackSpace takes the last character). */
export function applyEdits(query: string, edits: readonly Typed[]): string {
  let next = query;
  for (const edit of edits) {
    if (edit.kind === "text") next += edit.text;
    else if (edit.key === "BackSpace") next = [...next].slice(0, -1).join("");
  }
  return next;
}

/** Whether a typed key edits the text (rather than acting: Return, Escape, ↑ ↓). */
export const isEdit = (typed: Typed): boolean => typed.kind === "text" || typed.key === "BackSpace";

/**
 * The keys between a tap and the launcher being up. `begin` at the tap,
 * `push` each one that comes, `ready` once the field can take them (the
 * launcher hears the waiting ones, in order, and any late ones after them),
 * `end` when it closes (anything still waiting goes with it).
 *
 * The keyboard goes to the field only once it is `settled`: up, nothing
 * waiting, and the launcher has played in all it was given (`drained`). A
 * key typed while the field is still taking the typed-ahead text would
 * reach it before that text and be lost or put out of order.
 */
export class TypeAhead {
  private state: "closed" | "waiting" | "up" = "closed";
  private waiting: Typed[] = [];
  private listener: ((keys: readonly Typed[]) => void) | null = null;
  /** Keys given to the launcher that it hasn't played in yet. */
  private pending = false;
  private settledListener: (() => void) | null = null;

  /** The launcher is opening: keys from now on are kept for it. */
  begin(): void {
    this.state = "waiting";
    this.waiting = [];
    this.pending = false;
  }

  /** A key typed ahead; false when the launcher isn't opening or open (it is dropped). */
  push(typed: Typed): boolean {
    if (this.state === "closed") return false;
    this.waiting.push(typed);
    if (this.state === "up") this.deliver();
    return true;
  }

  /** The launcher is up: what waited goes to it. */
  ready(): void {
    if (this.state !== "waiting") return;
    this.state = "up";
    this.deliver();
    this.check();
  }

  isWaiting(): boolean {
    return this.state === "waiting";
  }

  /** Up, nothing waiting, and all it was given played in: the field may take the keyboard. */
  isSettled(): boolean {
    return this.state === "up" && this.waiting.length === 0 && !this.pending;
  }

  /** The launcher played in every key it was given (use-type-ahead.ts). */
  drained(): void {
    this.pending = false;
    this.check();
  }

  /** Hear each time it becomes settled (one listener: the shell's hand-off). */
  onSettled(listener: (() => void) | null): void {
    this.settledListener = listener;
  }

  end(): void {
    this.state = "closed";
    this.waiting = [];
    this.pending = false;
  }

  private check(): void {
    if (this.isSettled()) this.settledListener?.();
  }

  /** The launcher listens (one at a time); keys already up for it come at once. */
  readonly subscribe = (listener: (keys: readonly Typed[]) => void): (() => void) => {
    this.listener = listener;
    if (this.state === "up") this.deliver();
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  };

  private deliver(): void {
    if (!this.listener || this.waiting.length === 0) return;
    this.pending = true;
    this.listener(this.waiting.splice(0));
  }
}
