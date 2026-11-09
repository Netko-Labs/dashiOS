import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import type { Clipboard } from "../apps/kit/index.ts";
import { TerminalWindow } from "../apps/terminal/view.tsx";

// A stand-in for dashi-term with the shell integration: on its first resize
// it says the folder, a prompt, a failed command, and a frame with a wide
// character and the command's mark; each line it is sent goes to a log.
const fake = (log: string): string => `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const log = ${JSON.stringify(log)};
let started = false;
const say = (message) => console.log(JSON.stringify(message));
for await (const line of console) {
  if (!line) continue;
  appendFileSync(log, line + "\\n");
  const input = JSON.parse(line);
  if (input.t === "resize" && !started) {
    started = true;
    say({ t: "cwd", path: "/home/alexk/Developer/dashiOS", host: "" });
    say({ t: "prompt" });
    say({ t: "command", command: "false" });
    say({ t: "done", code: 1 });
    say({ t: "prompt" });
    say({
      t: "frame", cols: input.cols, rows: input.rows, full: true,
      cursor: { x: 2, y: 1, visible: true, style: "block" },
      lines: [{ y: 0, spans: [{ s: "$ false", x: 0, w: 7 }] }, { y: 1, spans: [{ s: "$ ", x: 0, w: 2 }, { s: "界", x: 2, w: 2 }] }],
      scroll: [input.rows, 0, input.rows], selected: true, marks: [{ y: 0, failed: true }],
    });
  }
}
`;

let dir = "";
let binary = "";
let log = "";
let runtime: string | undefined;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-terminal-view-"));
  binary = join(dir, "dashi-term");
  log = join(dir, "log");
  writeFileSync(binary, fake(log));
  writeFileSync(log, "");
  chmodSync(binary, 0o755);
  // No menus socket here: the kit's menus client stays quiet.
  runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
});
afterAll(() => {
  if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = runtime;
  rmSync(dir, { recursive: true, force: true });
});

function fakeHost() {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const emit = (event: NativeEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { transport, trees, emit };
}

const clipboard: Clipboard = { canWrite: true, writeText: async () => true, readText: async () => "" } as unknown as Clipboard;
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(20);
  }
}

test("one chrome row: the tab is named by its folder, the failed command is marked, and a second tab puts the tabs in the title bar", async () => {
  const host = fakeHost();
  const titles: string[] = [];
  const root = render(
    <TerminalWindow binary={binary} onExit={() => {}} newWindow={() => {}} setTitle={(title) => titles.push(title)} clipboard={clipboard} />,
    host.transport,
  );
  host.emit({ type: "chrome", nodeId: "root", titleBar: "unified", controls: { x: 8, y: 8, width: 60, height: 22 } });
  await wait(20);
  const node = (id: string): string => {
    const found = root.nodeId(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  // The cell is 8 px wide; the window's content 812 × 406 holds 98 × 21 cells inside the margins (12 each side, 6 over and under).
  host.emit({ type: "resize", nodeId: node("terminal-probe"), bounds: { x: 0, y: -200, width: 80, height: 18 } });
  host.emit({ type: "resize", nodeId: node("terminal-starting"), bounds: { x: 0, y: 38, width: 812, height: 406 } });
  await until(() => titles.includes("dashiOS"));
  await until(() => root.nodeId("terminal-mark-0") !== undefined);
  expect(root.nodeId("terminal-cursor")).toBeDefined();
  expect(root.nodeId("terminal-tabs")).toBeUndefined();
  const tree = host.trees.at(-1) ?? "";
  expect(tree).toContain("$ false");
  expect(tree).toContain("界");
  // The title bar's one row says the tab's name.
  expect(tree).toContain("dashiOS");
  expect(readLog()).toContain('"t":"resize","cols":98,"rows":21');

  // A press on the mark selects that command's output.
  host.emit({ type: "press", nodeId: node("terminal-mark-0") });
  await until(() => readLog().includes('"t":"select-output","y":0'));

  // A second tab: the tabs take the title bar's own row, each named by its folder.
  host.emit({ type: "press", nodeId: node("terminal-tab-new") });
  await until(() => root.nodeId("terminal-tab-1") !== undefined);
  expect(root.nodeId("terminal-tabs")).toBeDefined();
  // A strip too narrow for two: the tab in front stays, named, and the other folds into "+1", whose menu lists both.
  host.emit({ type: "resize", nodeId: node("terminal-tabs"), bounds: { x: 80, y: 6, width: 150, height: 26 } });
  await until(() => root.nodeId("terminal-tabs-more") !== undefined);
  expect(root.nodeId("terminal-tab-0")).toBeUndefined();
  expect(root.nodeId("terminal-tab-1")).toBeDefined();
  host.emit({ type: "press", nodeId: node("terminal-tabs-more") });
  await until(() => root.nodeId("terminal-tabs-menu") !== undefined);
  // Both engines heard their size before the window goes.
  await until(() => readLog().split('"t":"resize"').length === 3);
  root.unmount();
});

function readLog(): string {
  return readFileSync(log, "utf8");
}
