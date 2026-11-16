/**
 * Element numbers for native windows, kept per agent connection: an element
 * keeps its number for as long as its node lives (its bus name and path, the
 * same object while the toolkit keeps it), across reads, so a number read
 * once stays good for a click. A number is never given to anything else;
 * one whose element is gone says so (`act.ts`). Numbers are the
 * connection's, across windows: [12] names one element of one window.
 */

export interface Numbered {
  window: number;
  /** The node's bus name and path. */
  key: string;
  /** Its parent's key when it was read: where to read again around it once it is gone. */
  parent: string | null;
  /** What it was, for the words when it is gone: `button "Delete"`. */
  said: string;
}

export class TreeNumbers {
  private next = 1;
  private readonly byKey = new Map<string, number>();
  private readonly byNumber = new Map<number, Numbered>();

  /** The number of `key` in `window`, the same every time it is asked. */
  number(window: number, key: string, parent: string | null, said: string): number {
    const id = `${window}\u0000${key}`;
    let number = this.byKey.get(id);
    if (number === undefined) {
      number = this.next++;
      this.byKey.set(id, number);
    }
    this.byNumber.set(number, { window, key, parent, said });
    return number;
  }

  /** What `number` named, if this connection gave it. */
  get(number: number): Numbered | null {
    return this.byNumber.get(number) ?? null;
  }

  /** The number `key` has in `window`, if it has one. */
  find(window: number, key: string): number | null {
    return this.byKey.get(`${window}\u0000${key}`) ?? null;
  }

  /** The window closed: its numbers point nowhere now (never reused). */
  forgetWindow(window: number): void {
    for (const [number, entry] of this.byNumber) if (entry.window === window) this.byNumber.delete(number);
  }
}
