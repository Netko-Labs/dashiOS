import { expect, test } from "bun:test";
import type { NativeEvent } from "@mirinjs/metal";
import { type MenuSocketHandlers, MenusClient } from "../apps/kit/menus.ts";
import { onWindowTyping, typingOf } from "../apps/kit/typing.ts";
import { type AppMenu, parseClientMessage, parseShellMessage, type ShellMessage } from "../src/app-menus/protocol.ts";
import { isTextShortcut } from "../src/app-menus/shortcut.ts";
import { AppMenuStore } from "../src/app-menus/store.ts";
import { type Requests, runBinding, type ShellActions } from "../src/shortcuts.ts";

const EDIT: AppMenu[] = [
  {
    id: "edit",
    title: "Edit",
    items: [
      { kind: "item", id: "undo", label: "Undo Rename", shortcut: "❖Z", enabled: true },
      { kind: "item", id: "select-all", label: "Select All", shortcut: "❖A", enabled: true },
      { kind: "item", id: "find", label: "Find", shortcut: "❖F", enabled: true },
    ],
  },
];

function owner(pid: number) {
  const sent: ShellMessage[] = [];
  return { pid, sent, send: (message: ShellMessage) => void sent.push(message) };
}

test("the text chords are the ones a field answers itself", () => {
  for (const shortcut of ["❖A", "❖C", "❖X", "❖V", "❖Z", "⇧❖Z", "❖ a"]) expect(isTextShortcut(shortcut)).toBe(true);
  for (const shortcut of ["❖F", "⇧❖N", "❖W", "⌃❖A"]) expect(isTextShortcut(shortcut)).toBe(false);
});

test("while a field types, ❖A is left to it; the app's other chords still choose its rows", () => {
  const store = new AppMenuStore();
  const files = owner(40);
  store.publish(files, EDIT);
  expect(store.shortcut([40], "❖A")).toBe(true);
  store.publish(files, EDIT, true);
  expect(store.shortcut([40], "❖A")).toBe(false);
  expect(store.shortcut([40], "❖Z")).toBe(false);
  expect(store.shortcut([40], "❖F")).toBe(true);
  expect(files.sent).toEqual([
    { type: "select", id: "select-all" },
    { type: "select", id: "find" },
  ]);
});

test("❖A in a field becomes the field's Ctrl+A: the shell types it into the window", async () => {
  const store = new AppMenuStore();
  store.publish(owner(40), EDIT, true);
  const requests: [string, unknown][] = [];
  const compositor = {
    request: async (name: string, args: unknown) => void requests.push([name, args]),
    windows: async () => [],
  } as unknown as Requests;
  const actions = {
    hardware: { run: async () => false },
    appShortcut: async (_window: number, shortcut: string) => store.shortcut([40], shortcut),
  } as unknown as ShellActions;
  await runBinding("app-chord", 7, compositor, actions, { key: "a", shift: false, ctrl: false, alt: false });
  expect(requests).toEqual([["send-keys", { window: 7, chord: "ctrl+a" }]]);
});

test("❖Q tells each window's app it quits before asking the window to close", async () => {
  const order: string[] = [];
  const compositor = {
    request: async (name: string, args: { window: number }) => void order.push(`${name} ${args.window}`),
    windows: async () => [
      { id: 7, appId: "dev.dashi.terminal", pid: 70 },
      { id: 8, appId: "dev.dashi.terminal", pid: 80 },
      { id: 9, appId: "dev.dashi.files", pid: 90 },
    ],
  } as unknown as Requests;
  const actions = {
    hardware: { run: async () => false },
    appQuitting: (pid: number | null) => void order.push(`quitting ${pid}`),
  } as unknown as ShellActions;
  await runBinding("quit-app", 7, compositor, actions);
  expect(order).toEqual(["quitting 70", "close 7", "quitting 80", "close 8"]);
});

test("the store tells the app it quits on its menus channel", () => {
  const store = new AppMenuStore();
  const terminal = owner(70);
  store.publish(terminal, EDIT);
  // The window's host first, then the app's own process: the app is the one with menus.
  expect(store.quitting([71, 70])).toBe(true);
  expect(terminal.sent).toEqual([{ type: "quit" }]);
  expect(store.quitting([99])).toBe(false);
});

test("the channel carries typing and quit, and refuses a typing that isn't true or false", () => {
  const menus = { type: "menus", menus: [{ id: "edit", items: [{ id: "select-all", label: "Select All", shortcut: "❖A" }] }] };
  expect(parseClientMessage(JSON.stringify({ ...menus, typing: true }))).toMatchObject({ type: "menus", typing: true });
  expect(parseClientMessage(JSON.stringify(menus))).not.toHaveProperty("typing");
  expect(parseClientMessage(JSON.stringify({ ...menus, typing: "yes" }))).toEqual({ error: "typing must be true or false" });
  expect(parseShellMessage('{"type":"quit"}')).toEqual({ type: "quit" });
});

test("the kit sends its menus again when a field takes or lets go of the keyboard, and hears quit", () => {
  const lines: string[] = [];
  let handlers: MenuSocketHandlers | null = null;
  const client = new MenusClient({
    path: "/run/menus.sock",
    exists: () => true,
    connect: (_path, given) => {
      handlers = given;
      const write = (data: Uint8Array): number => {
        lines.push(new TextDecoder().decode(data));
        return data.byteLength;
      };
      given.open({ write, end: () => {} });
    },
  });
  let quits = 0;
  client.onQuit(() => quits++);
  client.setTyping(true);
  // Nothing published yet: nothing sent.
  expect(lines).toEqual([]);
  const spec = [{ id: "edit", items: [{ id: "select-all", label: "Select All", shortcut: "❖A" }] }];
  client.publish(spec);
  client.setTyping(true);
  client.setTyping(false);
  expect(lines.map((line) => JSON.parse(line).typing ?? false)).toEqual([true, false]);
  (handlers as MenuSocketHandlers | null)?.data(new TextEncoder().encode('{"type":"quit"}\n'));
  expect(quits).toBe(1);
});

test("the host's typing reaches the app once per change, and other events are not typing", () => {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const host = { onEvent: (listener: (event: NativeEvent) => void) => listeners.push(listener) };
  const seen: boolean[] = [];
  onWindowTyping(host, (typing) => seen.push(typing));
  const emit = (event: unknown): void => {
    for (const listener of listeners) listener(event as NativeEvent);
  };
  emit({ type: "typing", nodeId: "root", typing: false });
  emit({ type: "typing", nodeId: "root", typing: true });
  emit({ type: "typing", nodeId: "root", typing: true });
  emit({ type: "press", nodeId: "3" });
  emit({ type: "typing", nodeId: "root", typing: false });
  expect(seen).toEqual([true, false]);
  expect(typingOf({ type: "typing", nodeId: "5", typing: true })).toBeNull();
  expect(typingOf({ type: "typing", nodeId: "root" })).toBeNull();
  expect(typingOf(null)).toBeNull();
});
