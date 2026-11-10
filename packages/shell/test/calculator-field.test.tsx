import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as metal from "@mirinjs/metal";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { EN_US } from "../apps/calculator/locale.ts";
import { FRESH } from "../apps/calculator/store.ts";
import { CalculatorWindow } from "../apps/calculator/view.tsx";
import type { Clipboard } from "../apps/kit/index.ts";
import { settle } from "./support/time.ts";

// The Calculator against a stand-in for the Metal host's field that keeps its
// own buffer and caret as the host does (mirin `window::sync_inputs` and
// `selection::SelectionState`): typing edits it and reports the text, then the
// caret; a tree resets it to a value the app set (not one it reported), and to
// the tree's selection. Events and trees cross with the lag a real round trip has.

let dir = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-calculator-field-"));
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The host's `textHash` (mirin's FNV-1a over UTF-16 code units), when this
 * mirin has it: a mirin that does drops a selection made in a text the app has
 * since replaced (lib/field-texts.ts), which typing faster than a round trip needs.
 */
const mirinHash = (metal as Record<string, unknown>).textHash as ((text: string) => number) | undefined;
function textHash(text: string): number {
  if (mirinHash) return mirinHash(text);
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) hash = Math.imul(hash ^ text.charCodeAt(at), 0x01000193) >>> 0;
  return hash >>> 0;
}

type Range = [number, number];
const same = (a: Range | null, b: Range | null): boolean => a !== null && b !== null && a[0] === b[0] && a[1] === b[1];

interface InputProps {
  id: string;
  value: string;
  revision?: number;
  selection?: { start: number; end: number };
}

function findInput(node: unknown, id: string): InputProps | null {
  if (typeof node !== "object" || node === null) return null;
  const { type, props, children } = node as { type?: string; props?: InputProps; children?: unknown[] };
  if (type === "input" && props?.id === id) return props;
  for (const child of children ?? []) {
    const found = findInput(child, id);
    if (found) return found;
  }
  return null;
}

/** The host's field: its buffer, caret, and what it has told the app and not yet heard back. */
class HostField {
  buffer = "";
  anchor = 0;
  caret = 0;
  private synced = "";
  private revision = 0;
  private echoes: string[] = [];
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
    this.out.push({ type: "selection", nodeId: this.id, start: now[0], end: now[1], textHash: textHash(this.buffer) } as NativeEvent);
  }

  /** A key typed: it replaces the selection, and the field says so (text, then caret). */
  type(char: string): void {
    const [start, end] = this.range();
    this.buffer = this.buffer.slice(0, start) + char + this.buffer.slice(end);
    this.anchor = this.caret = start + char.length;
    this.echoes.push(this.buffer);
    this.out.push({ type: "change", nodeId: this.id, value: this.buffer });
    this.report();
  }

  /** A tree arrived with the field in it. */
  take(props: InputProps): void {
    let reset = false;
    const revision = props.revision ?? 0;
    if (revision !== this.revision) {
      this.revision = revision;
      reset = true;
    } else if (props.value !== this.synced) {
      const echoed = this.echoes.indexOf(props.value);
      if (echoed >= 0) this.echoes.splice(0, echoed + 1);
      else reset = true;
    }
    this.synced = props.value;
    if (reset) {
      this.echoes = [];
      this.buffer = props.value;
      this.anchor = this.caret = props.value.length;
    }
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
    if (moved) this.report();
  }
}

async function mount() {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const clipboard: Clipboard = { canWrite: true, writeText: async () => true, readText: async () => "" };
  const root = render(<CalculatorWindow clipboard={clipboard} locale={EN_US} remembered={FRESH} remember={() => {}} />, transport);
  await settle();
  const id = root.nodeId("line") ?? "";
  const field = new HostField(id);
  let taken = trees.length;
  for (const tree of trees) {
    const props = findInput(JSON.parse(tree), id);
    if (props) field.take(props);
  }
  field.out.length = 0;
  /** The app hears what the field said; the field takes the trees that came of it; until neither has anything left. */
  const roundTrips = (): void => {
    for (let round = 0; round < 50; round += 1) {
      const events = field.out.splice(0);
      for (const event of events) for (const listener of listeners) listener(event);
      const fresh = trees.slice(taken);
      taken = trees.length;
      for (const tree of fresh) {
        const props = findInput(JSON.parse(tree), id);
        if (props) field.take(props);
      }
      if (events.length === 0 && fresh.length === 0) return;
    }
    throw new Error("the field and the app never settled");
  };
  const line = (): InputProps => {
    const props = findInput(JSON.parse(trees.at(-1) ?? "{}"), id);
    if (!props) throw new Error("no line");
    return props;
  };
  return { root, field, roundTrips, line };
}

describe("the line as the field types it", () => {
  test("one key at a time, the caret stays after what was typed as the line regroups", async () => {
    const calc = await mount();
    for (const char of "1250*12+340") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("1,250 × 12 + 340");
    expect(calc.line().selection).toEqual({ start: 16, end: 16 });
    // The field draws what the app has: the same text, its caret at the end.
    expect(calc.field.buffer).toBe("1,250 × 12 + 340");
    expect([calc.field.anchor, calc.field.caret]).toEqual([16, 16]);
    calc.root.unmount();
  });

  test.if(mirinHash !== undefined)("typed faster than a round trip, no key is lost or misplaced", async () => {
    const typings: [string, string][] = [
      ["2+3", "2 + 3"],
      ["1/0", "1 ÷ 0"],
      ["1250*12+340", "1,250 × 12 + 340"],
    ];
    for (const [keys, want] of typings) {
      const calc = await mount();
      // Every key reaches the field before the app has answered the first.
      for (const char of keys) calc.field.type(char);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      expect(calc.field.caret).toBe(want.length);
      calc.root.unmount();
    }
  });

  test("a key the line refuses never stays in the field", async () => {
    const calc = await mount();
    for (const char of "12a") {
      calc.field.type(char);
      calc.roundTrips();
    }
    expect(calc.line().value).toBe("12");
    expect(calc.field.buffer).toBe("12");
    calc.root.unmount();
  });
});
