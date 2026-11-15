/**
 * A stand-in for the Metal host's field, as mirin's host keeps one at
 * `50241ea` (`crates/mirin-metal/src/value.rs`, `field/rebase.rs`,
 * `selection.rs`): its own buffer and caret; every edit reported with the
 * hash of the text it was made on and of the text it made, then the caret.
 * - A value the app wrote over a text the field has typed into since has the
 *   typing done again to it (a rebase), reported as one change made on the
 *   app's value. The rebase keeps its own caret, and says where it is.
 * - A new revision is such a write too, though the text may be the same
 *   (the app refused a key): the keys typed after it are carried onto it.
 * - A `selection` the app made in a text the field no longer holds (its
 *   `textHash`) is dropped. One the field takes from the tree as said is
 *   not reported back; a key, a click, typing, a rebase's caret and a
 *   reset's caret at the end are.
 */

import { type NativeEvent, textHash } from "@mirinjs/metal";

type Range = [number, number];
const same = (a: Range | null, b: Range | null): boolean => a !== null && b !== null && a[0] === b[0] && a[1] === b[1];

export interface InputProps {
  id: string;
  value: string;
  revision?: number;
  baseHash?: number;
  selection?: { start: number; end: number; textHash?: number };
}

type Taken = "kept" | "reset" | "rebased";

interface Splice {
  start: number;
  end: number;
  count: number;
}

function splice(from: string, to: string): Splice {
  const shortest = Math.min(from.length, to.length);
  let start = 0;
  while (start < shortest && from[start] === to[start]) start += 1;
  let tail = 0;
  while (tail < shortest - start && from[from.length - 1 - tail] === to[to.length - 1 - tail]) tail += 1;
  return { start, end: from.length - tail, count: to.length - tail - start };
}

/**
 * The field edited `known` into `held` (its caret at `cursor`) while the app
 * replaced `known` with `written`: the app's text with the field's edit in
 * it, and where the caret is now (`rebase.rs`, line for line).
 */
export function rebase(known: string, held: string, written: string, cursor: number = held.length): { text: string; caret: number } {
  const typed = splice(known, held);
  const wrote = splice(known, written);
  const typedText = held.slice(typed.start, typed.start + typed.count);
  const wroteText = written.slice(wrote.start, wrote.start + wrote.count);
  const tail = Math.max(typed.end, wrote.end);
  let text: string;
  let typedAt: number;
  if (typed.start < wrote.start) {
    typedAt = typed.start;
    text = known.slice(0, typed.start) + typedText + known.slice(Math.min(typed.end, wrote.start), wrote.start) + wroteText;
  } else if (typed.start >= wrote.end) {
    const before = known.slice(0, wrote.start) + wroteText + known.slice(wrote.end, typed.start);
    typedAt = before.length;
    text = before + typedText;
  } else {
    typedAt = wrote.start + wroteText.length;
    text = known.slice(0, wrote.start) + wroteText + typedText;
  }
  const body = text.length;
  text += known.slice(tail);
  const at = Math.min(cursor, held.length);
  let caret: number;
  if (at >= typed.start && at <= typed.start + typed.count) caret = typedAt + (at - typed.start);
  else if (at < typed.start) {
    if (at <= wrote.start) caret = at;
    else if (at >= wrote.end) caret = at - (wrote.end - wrote.start) + wrote.count;
    else caret = wrote.start + wrote.count;
  } else {
    const inKnown = at - typed.count + (typed.end - typed.start);
    caret = inKnown >= tail ? text.length - (known.length - inKnown) : body;
  }
  return { text, caret };
}

/** The host's field: its buffer, caret, and what it has told the app and not yet heard back. */
export class HostField {
  buffer = "";
  anchor = 0;
  caret = 0;
  private synced = "";
  private revision = 0;
  private echoes: string[] = [];
  /** The hash of the text the next change is made on. */
  private base: number = textHash("");
  private selectionSynced: Range | null = [0, 0];
  private selectionEchoes: Range[] = [];
  private reported: Range = [0, 0];
  readonly out: NativeEvent[] = [];

  constructor(readonly id: string) {}

  private range(): Range {
    return [Math.min(this.anchor, this.caret), Math.max(this.anchor, this.caret)];
  }

  private report(): void {
    const now = this.range();
    if (same(now, this.reported)) return;
    this.reported = now;
    this.selectionEchoes.push(now);
    this.out.push({ type: "selection", nodeId: this.id, start: now[0], end: now[1], textHash: textHash(this.buffer) });
  }

  private reportChange(): void {
    const hash = textHash(this.buffer);
    this.out.push({ type: "change", nodeId: this.id, value: this.buffer, baseHash: this.base, textHash: hash });
    this.base = hash;
    this.echoes.push(this.buffer);
  }

  /** A key typed: it replaces the selection, and the field says so (text, then caret). */
  type(char: string): void {
    const [start, end] = this.range();
    this.buffer = this.buffer.slice(0, start) + char + this.buffer.slice(end);
    this.anchor = this.caret = start + char.length;
    this.reportChange();
    this.report();
  }

  /** The person selects in the field, which says so. */
  select(anchor: number, caret: number): void {
    this.anchor = anchor;
    this.caret = caret;
    this.report();
  }

  private reset(value: string): Taken {
    this.echoes = [];
    this.buffer = value;
    this.anchor = this.caret = value.length;
    return "reset";
  }

  /** A value the app wrote over the text hashing to `baseHash`: what the field typed into that text since is done again to it. */
  private takeWrite(value: string, baseHash: number): Taken {
    const known = [this.synced, ...this.echoes].reverse().find((text) => textHash(text) === baseHash);
    if (known === undefined || known === this.buffer) return this.reset(value);
    const rebased = rebase(known, this.buffer, value, this.caret);
    this.buffer = rebased.text;
    this.anchor = this.caret = rebased.caret;
    this.echoes = [];
    return "rebased";
  }

  /** The app's new value, written over the text hashing to `baseHash`. */
  private takeValue(value: string, baseHash: number | undefined): Taken {
    const echoed = this.echoes.indexOf(value);
    if (baseHash === undefined) {
      if (echoed < 0) return this.reset(value);
      this.echoes.splice(0, echoed + 1);
      return "kept";
    }
    if (baseHash !== textHash(value)) return this.takeWrite(value, baseHash);
    if (echoed >= 0) this.echoes.splice(0, echoed + 1);
    return "kept";
  }

  /** The tree's `selection`, taken when it is the app's news and made in the text the field holds; never said back as it was said. */
  private takeSelection(selection: InputProps["selection"], taken: Taken): void {
    const wanted: Range | null = selection ? [selection.start, selection.end] : null;
    const reset = taken === "reset";
    let took: Range | null = null;
    if (selection && wanted) {
      const late = selection.textHash === undefined ? taken === "rebased" : selection.textHash !== textHash(this.buffer);
      let sets = reset;
      if (!reset && !same(wanted, this.selectionSynced) && !late) {
        const echoed = this.selectionEchoes.findIndex((range) => same(range, wanted));
        if (echoed >= 0) this.selectionEchoes.splice(0, echoed + 1);
        else sets = true;
      }
      if (sets) {
        this.selectionEchoes = [];
        this.anchor = Math.min(wanted[0], this.buffer.length);
        this.caret = Math.min(wanted[1], this.buffer.length);
        took = wanted;
      }
    }
    this.selectionSynced = wanted;
    // Taken as said: the app's own word, not told to it. Put elsewhere (past the end): told.
    if (took && same(this.range(), took)) this.reported = took;
    else if (took || reset) this.report();
  }

  /** A tree arrived with the field in it. */
  take(props: InputProps): void {
    let taken: Taken = "kept";
    const revision = props.revision ?? 0;
    if (revision !== this.revision) {
      this.revision = revision;
      taken = props.baseHash === undefined ? this.reset(props.value) : this.takeWrite(props.value, props.baseHash);
    } else if (props.value !== this.synced) taken = this.takeValue(props.value, props.baseHash);
    this.synced = props.value;
    if (taken !== "kept") this.base = textHash(props.value);
    if (taken === "rebased") this.reportChange();
    this.takeSelection(props.selection, taken);
    if (taken === "rebased") this.report();
  }
}
