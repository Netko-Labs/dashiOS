/**
 * Keys for a window with nothing to type into. Metal reports keys only
 * through a focused text input: the text it holds after each keystroke, plus
 * Enter, Esc, and the up and down arrows. So the kit keeps an invisible input
 * focused (keys.tsx) and turns each change of its buffer back into the keys
 * that made it: the characters typed (or pasted, Ctrl+V reads the clipboard
 * into the input), and Backspaces.
 *
 * The buffer starts as a run of filler characters nobody types, so a
 * Backspace always has something to delete, and is put back after every
 * keystroke. A reset and a keystroke can cross on the way (the host sends the
 * change before it sees the reset), so resets alternate between two fillers,
 * and a change says by its filler which buffer it came from.
 */

export type KeyInput =
  /** Characters typed or pasted. */
  | { kind: "text"; text: string }
  | { kind: "backspace" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "up" }
  | { kind: "down" };

const FILLERS = [" ", " "] as const;
const RUN = 8;

/** The buffer each epoch starts from. */
export function sentinel(epoch: 0 | 1): string {
  return FILLERS[epoch].repeat(RUN);
}

const isFiller = (char: string): boolean => char === FILLERS[0] || char === FILLERS[1];

/** What changed between two buffers: the run removed and the text put in its place. */
export function diffBuffers(before: string, after: string): { removed: string; inserted: string } {
  const a = [...before];
  const b = [...after];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { removed: a.slice(head, a.length - tail).join(""), inserted: b.slice(head, b.length - tail).join("") };
}

/**
 * The keys a buffer change stands for. One deleted character is a Backspace;
 * a longer run of filler gone at once is a select-all being typed over
 * (Ctrl+A, then a key), which deletes nothing the app knows of.
 */
export function keysFor(before: string, after: string): KeyInput[] {
  const { removed, inserted } = diffBuffers(before, after);
  const keys: KeyInput[] = [];
  const chars = [...removed];
  const typedOver = chars.length > 1 && chars.every(isFiller);
  if (!typedOver) for (const _ of chars) keys.push({ kind: "backspace" });
  const text = [...inserted].filter((char) => !isFiller(char)).join("");
  if (text) keys.push({ kind: "text", text });
  return keys;
}

/**
 * The sink's bookkeeping, apart from React: what the input should hold
 * (`value`), and what each change means.
 */
export class KeyBuffer {
  private epoch: 0 | 1 = 0;
  /** The last buffer seen in each epoch. */
  private readonly last: [string, string] = [sentinel(0), sentinel(1)];

  get value(): string {
    return sentinel(this.epoch);
  }

  /** The input now holds `text`: the keys it stands for. Afterwards `value` may have moved on (a reset). */
  change(text: string): KeyInput[] {
    const epoch = this.epochOf(text);
    const keys = keysFor(this.last[epoch], text);
    this.last[epoch] = text;
    // Anything but the clean run of the current epoch (a keystroke, a moved caret, a select-all):
    // start over from the other filler, which also puts the caret back at the end.
    if (epoch === this.epoch) {
      this.epoch = epoch === 0 ? 1 : 0;
      this.last[this.epoch] = sentinel(this.epoch);
    }
    return keys;
  }

  /** A change belongs to the epoch whose filler it holds; with neither left, to the current one. */
  private epochOf(text: string): 0 | 1 {
    const has0 = text.includes(FILLERS[0]);
    const has1 = text.includes(FILLERS[1]);
    if (has0 !== has1) return has0 ? 0 : 1;
    return this.epoch;
  }
}

/** A typed character as a key name the app can match: "a", "5", "+", "Enter", "Backspace". */
export function keyName(input: KeyInput): string {
  switch (input.kind) {
    case "text":
      return input.text;
    case "backspace":
      return "Backspace";
    case "enter":
      return "Enter";
    case "escape":
      return "Escape";
    case "up":
      return "ArrowUp";
    case "down":
      return "ArrowDown";
  }
}
