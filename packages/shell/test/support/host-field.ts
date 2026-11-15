/**
 * A stand-in for the Metal host's field, as mirin's host keeps one
 * (`crates/mirin-metal/src/value.rs`, `field/rebase.rs`, `selection.rs`): its
 * own buffer and caret; every edit reported with the hash of the text it was
 * made on and of the text it made, then the caret; a value the app wrote over
 * a text the field has typed into since has the typing done again to it (a
 * rebase), reported as one change made on the app's value; a new revision
 * resets the buffer, whatever was typed.
 */

import { type NativeEvent, textHash } from "@mirinjs/metal";

type Range = [number, number];
const same = (a: Range | null, b: Range | null): boolean => a !== null && b !== null && a[0] === b[0] && a[1] === b[1];

export interface InputProps {
  id: string;
  value: string;
  revision?: number;
  baseHash?: number;
  selection?: { start: number; end: number };
}

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

/** The field edited `known` into `held` while the app replaced `known` with `written`: the app's text with the field's edit in it, and the caret. */
export function rebase(known: string, held: string, written: string): { text: string; caret: number } {
  const typed = splice(known, held);
  const wrote = splice(known, written);
  const typedText = held.slice(typed.start, typed.start + typed.count);
  const wroteText = written.slice(wrote.start, wrote.start + wrote.count);
  const tail = Math.max(typed.end, wrote.end);
  let text: string;
  if (typed.start < wrote.start) text = known.slice(0, typed.start) + typedText + known.slice(Math.min(typed.end, wrote.start), wrote.start) + wroteText;
  else if (typed.start >= wrote.end) text = known.slice(0, wrote.start) + wroteText + known.slice(wrote.end, typed.start) + typedText;
  else text = known.slice(0, wrote.start) + wroteText + typedText;
  const caret = typed.start < wrote.start ? typed.start + typed.count : text.length;
  return { text: text + known.slice(tail), caret };
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

  /** The app's new value, written over the text hashing to `baseHash`. */
  private takeValue(value: string, baseHash: number | undefined): "kept" | "reset" | "rebased" {
    if (baseHash === undefined) {
      const echoed = this.echoes.indexOf(value);
      if (echoed >= 0) {
        this.echoes.splice(0, echoed + 1);
        return "kept";
      }
    } else if (baseHash === textHash(value)) {
      const echoed = this.echoes.indexOf(value);
      if (echoed >= 0) this.echoes.splice(0, echoed + 1);
      return "kept";
    } else {
      const known = [this.synced, ...this.echoes].reverse().find((text) => textHash(text) === baseHash);
      if (known !== undefined && known !== this.buffer) {
        const rebased = rebase(known, this.buffer, value);
        this.buffer = rebased.text;
        this.anchor = this.caret = rebased.caret;
        this.echoes = [];
        return "rebased";
      }
    }
    this.echoes = [];
    this.buffer = value;
    this.anchor = this.caret = value.length;
    return "reset";
  }

  /** A tree arrived with the field in it. */
  take(props: InputProps): void {
    let taken: "kept" | "reset" | "rebased" = "kept";
    const revision = props.revision ?? 0;
    if (revision !== this.revision) {
      this.revision = revision;
      this.echoes = [];
      this.buffer = props.value;
      this.anchor = this.caret = props.value.length;
      taken = "reset";
    } else if (props.value !== this.synced) taken = this.takeValue(props.value, props.baseHash);
    this.synced = props.value;
    if (taken !== "kept") this.base = textHash(props.value);
    if (taken === "rebased") this.reportChange();
    const reset = taken === "reset";
    const wanted: Range | null = props.selection ? [props.selection.start, props.selection.end] : null;
    let moved = reset;
    if (wanted) {
      let driverSets = reset;
      if (!reset && !same(wanted, this.selectionSynced)) {
        const echoed = this.selectionEchoes.findIndex((range) => same(range, wanted));
        if (echoed >= 0) this.selectionEchoes.splice(0, echoed + 1);
        else driverSets = true;
      }
      if (driverSets) {
        this.selectionEchoes = [];
        this.anchor = Math.min(wanted[0], this.buffer.length);
        this.caret = Math.min(wanted[1], this.buffer.length);
        moved = true;
      }
    }
    this.selectionSynced = wanted;
    if (moved || taken === "rebased") this.report();
  }
}
