import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as metal from "@mirinjs/metal";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { EN_US } from "../apps/calculator/lib/locale.ts";
import { FRESH } from "../apps/calculator/lib/store.ts";
import { CalculatorWindow } from "../apps/calculator/lib/view.tsx";
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

  /** The person selects in the field, which says so. */
  select(anchor: number, caret: number): void {
    this.anchor = anchor;
    this.caret = caret;
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
  /** The app hears the oldest `count` things the field said (all of them by default); how many it heard. */
  const hear = (count = Number.POSITIVE_INFINITY): number => {
    const events = field.out.splice(0, count);
    for (const event of events) for (const listener of listeners) listener(event);
    return events.length;
  };
  /** The field takes the trees the app sent since it last looked; how many. */
  const takeTrees = (): number => {
    const fresh = trees.slice(taken);
    taken = trees.length;
    for (const tree of fresh) {
      const props = findInput(JSON.parse(tree), id);
      if (props) field.take(props);
    }
    return fresh.length;
  };
  /** The app hears what the field said; the field takes the trees that came of it; until neither has anything left. */
  const roundTrips = (): void => {
    for (let round = 0; round < 50; round += 1) if (hear() + takeTrees() === 0) return;
    throw new Error("the field and the app never settled");
  };
  const line = (): InputProps => {
    const props = findInput(JSON.parse(trees.at(-1) ?? "{}"), id);
    if (!props) throw new Error("no line");
    return props;
  };
  /** A keypad key pressed: the app hears it at once; the field has not taken the tree that came of it. */
  const press = (testID: string): void => {
    const event = { type: "press", nodeId: root.nodeId(testID) ?? "" } as NativeEvent;
    for (const listener of listeners) listener(event);
  };
  return { root, field, roundTrips, line, press, hear, takeTrees };
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

  // An agent's click on a key and its typing 5 ms later (dashi-0.9.0-review/13-final-fixes): the
  // field types on the text it had before the key, and the line had "76" and no sum.
  test("typed before the field took a keypad key, the keys land after it", async () => {
    for (const [before, key, typed, want] of [
      ["", "key:7", "*6=", "42"],
      ["", "key:7", "+", "7 +"],
      ["12", "key:3", "+4", "123 + 4"],
      ["9", "key:plus", "1", "9 + 1"],
      ["", "key:7", "7", "77"],
    ] as const) {
      const calc = await mount();
      for (const char of before) calc.field.type(char);
      calc.roundTrips();
      calc.press(key);
      for (const char of typed) calc.field.type(char);
      calc.roundTrips();
      expect(calc.line().value).toBe(want);
      expect(calc.field.buffer).toBe(want);
      calc.root.unmount();
    }
  });

  test("once the field took a keypad key, what replaces it replaces it", async () => {
    const calc = await mount();
    calc.press("key:7");
    calc.roundTrips();
    expect(calc.field.buffer).toBe("7");
    calc.field.select(0, 1);
    calc.field.type("8");
    calc.roundTrips();
    expect(calc.line().value).toBe("8");
    calc.field.type("5");
    calc.roundTrips();
    expect(calc.line().value).toBe("85");
    calc.root.unmount();
  });

  // The same with several calls 2 ms apart (click 7, "+2", ⇧8, "3="): the field types while trees
  // it has not taken yet are on their way, and takes them between its keys, in any order of the two.
  test("whatever the order of the field's reports and the trees it takes, every key lands once, in order", async () => {
    let seed = 7;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    for (const [before, key, typed, want] of [
      ["", "key:7", "+2*3=", "13|13"],
      ["12", "key:plus", "3*4-5=", "19|19"],
    ] as const) {
      const outcomes = new Map<string, number>();
      for (let run = 0; run < 150; run += 1) {
        const calc = await mount();
        const crossings = (): void => {
          for (let turns = Math.floor(random() * 4); turns > 0; turns -= 1) {
            if (random() < 0.5) calc.hear(1);
            else calc.takeTrees();
          }
        };
        for (const char of before) calc.field.type(char);
        calc.roundTrips();
        calc.press(key);
        for (const char of typed) {
          crossings();
          calc.field.type(char);
        }
        let got: string;
        try {
          calc.roundTrips();
          got = `${calc.line().value}|${calc.field.buffer}`;
        } catch {
          got = "never settled";
        }
        outcomes.set(got, (outcomes.get(got) ?? 0) + 1);
        calc.root.unmount();
      }
      expect(Object.fromEntries(outcomes)).toEqual({ [want]: 150 });
    }
  });
});
