import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { Monitor } from "../apps/activity-monitor/monitor.ts";
import type { ProcessSample, Snapshot } from "../apps/activity-monitor/read.ts";
import { type MonitorActions, MonitorWindow } from "../apps/activity-monitor/view.tsx";
import { settle } from "./support/time.ts";

// Activity Monitor's window on a stand-in for the Metal host: who has the keyboard, ← and → on the list, Esc on Inspect.

let runtime: string | undefined;
beforeAll(() => {
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "dashi-monitor-runtime-"));
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
});

const TERMINAL = { key: "dev.dashi.terminal", name: "Terminal", icon: "/icons/terminal.svg" };

const proc = (pid: number, fields: Partial<ProcessSample> = {}): ProcessSample => ({
  pid,
  ppid: 1,
  name: `p${pid}`,
  uid: 1000,
  state: "S",
  cpuTicks: 0,
  threads: 1,
  starttime: 100,
  memory: 0,
  kernel: false,
  io: null,
  sockets: null,
  command: "",
  app: null,
  wakeups: null,
  gpu: null,
  ...fields,
});

const look = (processes: ProcessSample[]): Snapshot => ({
  at: Date.now(),
  processes: new Map(processes.map((each) => [each.pid, each])),
  cpu: null,
  memory: null,
  disk: { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 },
  net: { packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0 },
});

async function mount() {
  const processes = [
    proc(10, { name: "terminal", app: TERMINAL, memory: 9_000_000 }),
    proc(11, { name: "bash", ppid: 10, app: TERMINAL }),
    proc(20, { name: "lonely" }),
  ];
  const monitor = new Monitor({ users: new Map([[1000, "alexk"]]), ownUid: 1000, clockTicks: 100 }, async () => look(processes));
  await monitor.refresh();
  const actions: MonitorActions = {
    signal: () => "sent",
    alive: () => false,
    guard: { protectedPids: new Set(), self: 1 },
    copy() {},
    onOpen: () => () => {},
  } as unknown as MonitorActions;
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(<MonitorWindow monitor={monitor} actions={actions} />, transport);
  await settle();
  const node = (testID: string): string => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no node ${testID}`);
    return id;
  };
  const emit = async (event: NativeEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  return {
    root,
    node,
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: (testID: string) => emit({ type: "press", nodeId: node(testID) }),
    emitRaw: emit,
    emitContextMenu: (testID: string) => emit({ type: "contextmenu", nodeId: node(testID), x: 100, y: 100 } as NativeEvent),
    key: (testID: string, key: string) =>
      emit({ type: "windowkey", nodeId: node(testID), key, ctrl: false, alt: false, shift: false, meta: false, repeat: false }),
  };
}

const autofocused = (root: NativeRoot): boolean => (root.lastTree() ?? "").includes('"autofocus":true');

test("the list has the keyboard: a click on a row takes it back from the field, and ← → close and open an app", async () => {
  const view = await mount();
  // At open the field doesn't take the keyboard: the list's keys do.
  expect(autofocused(view.root)).toBe(false);
  expect(view.has("list-keys")).toBe(true);
  const before = view.node("list-keys");
  await view.press("processes:row:app:dev.dashi.terminal");
  // Remounted: a new key view appearing hands the keyboard to the window, away from a field the person clicked.
  expect(view.node("list-keys")).not.toBe(before);
  await view.key("list-keys", "right");
  expect(view.has("processes:row:pid:11")).toBe(true);
  await view.key("list-keys", "down");
  await view.key("list-keys", "down");
  // ← on one of its processes goes up to the app; again closes it.
  await view.key("list-keys", "left");
  await view.key("list-keys", "left");
  expect(view.has("processes:row:pid:11")).toBe(false);
  expect(view.has("processes:row:app:dev.dashi.terminal")).toBe(true);
  view.root.unmount();
});

test("Return in the search selects what it found and hands the keyboard to the list", async () => {
  const view = await mount();
  const before = view.node("list-keys");
  await view.emitRaw({ type: "change", nodeId: view.node("search"), value: "term" });
  await view.emitRaw({ type: "submit", nodeId: view.node("search"), value: "term" });
  expect(view.node("list-keys")).not.toBe(before);
  await view.key("list-keys", "right");
  expect(view.has("processes:row:pid:11")).toBe(true);
  view.root.unmount();
});

test("Inspect from the menu leaves the keyboard to its sheet, and Esc closes it", async () => {
  const view = await mount();
  await view.emitContextMenu("processes:row:app:dev.dashi.terminal");
  await view.key("line-menu:keys", "down");
  await view.key("line-menu:keys", "enter");
  expect(view.has("inspect-sheet")).toBe(true);
  // The field isn't handed the keyboard under the sheet (it took Esc before).
  expect(autofocused(view.root)).toBe(false);
  await view.key("inspect-sheet:keys", "escape");
  expect(view.has("inspect-sheet")).toBe(false);
  view.root.unmount();
});

test("in a narrow, short window search is a glyph that opens the field in the tabs' place, and the summary is one line", async () => {
  const view = await mount();
  expect(view.has("search")).toBe(true);
  expect(view.has("summary-graph")).toBe(true);
  await view.emitRaw({ type: "resize", nodeId: view.node("monitor-window"), bounds: { x: 0, y: 0, width: 600, height: 400 } });
  expect(view.has("search")).toBe(false);
  expect(view.has("tabs")).toBe(true);
  expect(view.has("summary-brief")).toBe(true);
  expect(view.has("summary-graph")).toBe(false);
  await view.press("search-open");
  expect(view.has("search")).toBe(true);
  expect(view.has("tabs")).toBe(false);
  expect(autofocused(view.root)).toBe(true);
  // A query keeps the field showing after the list takes the keyboard back.
  await view.emitRaw({ type: "change", nodeId: view.node("search"), value: "term" });
  await view.press("processes:row:app:dev.dashi.terminal");
  expect(view.has("search")).toBe(true);
  // Emptied while the list has the keyboard, the tabs come back; opened again, Esc in the empty field gives them back too.
  await view.emitRaw({ type: "change", nodeId: view.node("search"), value: "" });
  expect(view.has("tabs")).toBe(true);
  await view.press("search-open");
  expect(view.has("tabs")).toBe(false);
  await view.emitRaw({ type: "key", nodeId: view.node("search"), value: "Escape" });
  expect(view.has("search")).toBe(false);
  expect(view.has("tabs")).toBe(true);
  view.root.unmount();
});
