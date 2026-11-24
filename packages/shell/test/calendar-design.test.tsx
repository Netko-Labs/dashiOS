import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lightColors } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { CalendarModel } from "../apps/calendar/lib/model.ts";
import { CalendarWindow } from "../apps/calendar/lib/views/view.tsx";
import { CalendarStore } from "../src/shared/calendar/store.ts";
import { settle } from "./support/time.ts";

// Calendar on the kit (0.10 design plan, W6): the now line in ink, the sidebar's month the kit's
// MonthGrid, the calendars as sidebar rows with the kit's check box, Find's empty list "No results".

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;
function find(node: Node, id: string): Node | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isNode(child) ? find(child, id) : undefined)).find(Boolean);
}

let dir = "";
let model: CalendarModel;
let root: NativeRoot;
let trees: string[] = [];
let listeners: ((event: NativeEvent) => void)[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dashi-calendar-design-"));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  model = new CalendarModel(new CalendarStore(dir), () => now, { view: "week", day: today });
  trees = [];
  listeners = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  root = render(<CalendarWindow model={model} chooser={{ choose: async () => null }} />, transport);
  await settle();
});
afterEach(() => {
  root.unmount();
  rmSync(dir, { recursive: true, force: true });
});

const tree = (): Node => JSON.parse(trees.at(-1) ?? "{}") as Node;
const id = (testID: string): string => {
  const found = root.nodeId(testID);
  if (!found) throw new Error(`no node ${testID}`);
  return found;
};
const emit = async (event: NativeEvent): Promise<void> => {
  for (const listener of listeners) listener(event);
  await settle();
};

test("the time now is drawn in ink, never the accent", () => {
  const line = find(tree(), id("now"))?.children?.filter(isNode) ?? [];
  expect(line.length).toBe(2);
  for (const part of line) {
    expect(part.props.background).toBe(lightColors.text);
    expect(part.props.background).not.toBe(lightColors.selection);
  }
});

test("the sidebar's month is the kit's month grid, and the calendars are sidebar rows with a check box", () => {
  expect(root.nodeId("mini:previous")).toBeTruthy();
  const calendar = model.getSnapshot().calendars[0];
  if (!calendar) throw new Error("no calendar");
  const row = find(tree(), id(`calendar:${calendar.id}`));
  expect(row?.props.focusable).toBe(true);
  const check = find(tree(), id(`calendar-check:${calendar.id}`));
  expect((check?.props.access as { role?: string } | undefined)?.role ?? check?.props.role).toBe("checkbox");
});

test("Find says “No results” in its one row when nothing matches", async () => {
  await emit({ type: "press", nodeId: id("find-button") });
  await emit({ type: "change", nodeId: id("find"), value: "zzz nothing" });
  expect(root.nodeId("no-results")).toBeTruthy();
});
