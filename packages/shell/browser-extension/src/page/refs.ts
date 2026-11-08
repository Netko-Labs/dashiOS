/**
 * Element numbers across a tab's frames. Each frame numbers its own elements
 * and writes them between two private-use characters, which a page's own
 * text can't hold (they are taken out of it: `unmark`); the background gives
 * each (frame's document, number) a number of the tab's (`RefTable`) and
 * writes those in (`renumber`). The same element keeps its number for as
 * long as its document lives, so a number read stays good for a click.
 */

const OPEN = "";
const CLOSE = "";
const MARKED = /(\d{1,9})/g;

/** A frame's own number for an element, marked for the background. */
export const marker = (ref: number): string => `${OPEN}${ref}${CLOSE}`;

/** A page's text without the characters markers are made of. */
export const unmark = (text: string): string => text.replace(/[]/g, "");

/** `text` with every marked number replaced by `to`'s; a number `to` has none for is dropped. */
export function renumber(text: string, to: (local: number) => number | null): string {
  return text.replace(MARKED, (_, local: string) => String(to(Number(local)) ?? "?"));
}

/** Where a tab's number points: a frame, the document in it (content.ts names each), and the frame's own number. */
export interface RefTarget {
  frameId: number;
  doc: string;
  local: number;
}

/** A tab's numbers. A new page in the tab starts a new table. */
export class RefTable {
  private next = 1;
  private readonly byTarget = new Map<string, number>();
  private readonly byRef = new Map<number, RefTarget>();

  /** The tab's number for a frame's element, the same each time it is asked. */
  ref(target: RefTarget): number {
    const key = `${target.frameId}/${target.doc}/${target.local}`;
    let ref = this.byTarget.get(key);
    if (ref === undefined) {
      ref = this.next++;
      this.byTarget.set(key, ref);
      this.byRef.set(ref, target);
    }
    return ref;
  }

  target(ref: number): RefTarget | null {
    return this.byRef.get(ref) ?? null;
  }

  /** A frame's document went (it navigated): its numbers point nowhere now. */
  forgetDocument(frameId: number, doc: string): void {
    for (const [ref, target] of this.byRef) {
      if (target.frameId === frameId && target.doc === doc) this.byRef.delete(ref);
    }
  }
}
