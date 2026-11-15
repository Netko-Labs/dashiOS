/**
 * The Calculator against a stand-in for the Metal host's field
 * (`host-field.ts`). Events and trees cross with the lag a real round trip
 * has, all at once (`roundTrips`) or one way at a time (`hear`, `takeTrees`).
 */

import { afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { EN_US } from "../../apps/calculator/lib/locale.ts";
import { FRESH } from "../../apps/calculator/lib/store.ts";
import { CalculatorWindow } from "../../apps/calculator/lib/view.tsx";
import type { Clipboard } from "../../apps/kit/index.ts";
import { HostField, type InputProps } from "./host-field.ts";
import { settle, shows } from "./time.ts";

/** The Calculator's state file goes to a folder of the test's own, for the file that calls this. */
export function ownRuntimeDir(): void {
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

/** What mirin's host at `50241ea` says of its fields (whole trees, no patches): it carries typing onto a write and onto a new revision, drops a selection made in another text, and says back none it was told. */
const REBASES: NativeEvent = { type: "protocol", nodeId: "root", patches: 0, rebase: true, selectionHash: true, noSelectionEcho: true, revisionRebase: true };

export async function mount() {
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
  // The line itself, however many turns the file's first render takes in a busy run; then what it set going.
  const id = await shows(root, "line");
  await settle();
  for (const listener of listeners) listener(REBASES);
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
