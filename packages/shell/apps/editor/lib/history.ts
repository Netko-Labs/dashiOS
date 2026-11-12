/**
 * Undo and Redo. Metal's text input keeps no history of its own, so each
 * change the input reports is kept here as the span it replaced (`at`,
 * `removed`, `inserted`: the common start and end of the two texts are left
 * out, so a keystroke in a large file costs a few bytes). Typing that carries
 * on where the last change ended, or Backspace after Backspace, joins that
 * change while it comes within `JOIN_MS`, so Undo takes back a run of typing
 * rather than one character. Each step has a name for Edit's rows, as every
 * app's Undo has (@dashi/ui's `undoLabel`): "Typing", or what made it
 * ("Replace All", "Revert").
 */

export interface Change {
  at: number;
  removed: string;
  inserted: string;
}

/** How soon after the last change a continuing one still joins it. */
export const JOIN_MS = 1500;
/** How many changes Undo can take back. */
export const HISTORY_LIMIT = 500;
/** What a step of typing (or deleting) is called. */
export const TYPING = "Typing";

/** A change kept for Undo, with what Edit calls it. */
type Step = Change & { name: string };

/** The span that turns `before` into `after`; null when they are the same. */
export function diff(before: string, after: string): Change | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < shortest - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { at: start, removed: before.slice(start, before.length - end), inserted: after.slice(start, after.length - end) };
}

export function apply(text: string, change: Change): string {
  return text.slice(0, change.at) + change.inserted + text.slice(change.at + change.removed.length);
}

export function invert(change: Change): Change {
  return { at: change.at, removed: change.inserted, inserted: change.removed };
}

/** `next` folded into `last` when it continues it: typing on, or deleting backwards. Null when it does not. */
export function join(last: Change, next: Change): Change | null {
  const typing = last.removed === "" && next.removed === "" && next.at === last.at + last.inserted.length && !next.inserted.includes("\n");
  if (typing) return { at: last.at, removed: "", inserted: last.inserted + next.inserted };
  const deleting = last.inserted === "" && next.inserted === "" && next.at + next.removed.length === last.at;
  if (deleting) return { at: next.at, removed: next.removed + last.removed, inserted: "" };
  return null;
}

export class History {
  private past: Step[] = [];
  private future: Step[] = [];
  private lastTime = Number.NEGATIVE_INFINITY;

  constructor(private readonly limit: number = HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What Undo would take back ("Typing", "Replace All"), null when nothing. */
  get undoName(): string | null {
    return this.past.at(-1)?.name ?? null;
  }

  get redoName(): string | null {
    return this.future.at(-1)?.name ?? null;
  }

  /** The text went from `before` to `after`; `joinable` false keeps it its own step (a paste, a Replace All), named `name`. */
  record(before: string, after: string, now: number, joinable = true, name: string = TYPING): void {
    const change = diff(before, after);
    if (!change) return;
    this.future = [];
    const last = this.past.at(-1);
    const joined = joinable && last && last.name === TYPING && now - this.lastTime <= JOIN_MS ? join(last, change) : null;
    if (joined) this.past[this.past.length - 1] = { ...joined, name: TYPING };
    else this.past.push({ ...change, name: joinable ? TYPING : name });
    if (this.past.length > this.limit) this.past.shift();
    this.lastTime = joinable ? now : Number.NEGATIVE_INFINITY;
  }

  /** `text` with the last change taken back, or null when there is none. */
  undo(text: string): string | null {
    const change = this.past.pop();
    if (!change) return null;
    this.future.push(change);
    this.lastTime = Number.NEGATIVE_INFINITY;
    return apply(text, invert(change));
  }

  redo(text: string): string | null {
    const change = this.future.pop();
    if (!change) return null;
    this.past.push(change);
    this.lastTime = Number.NEGATIVE_INFINITY;
    return apply(text, change);
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.lastTime = Number.NEGATIVE_INFINITY;
  }
}
