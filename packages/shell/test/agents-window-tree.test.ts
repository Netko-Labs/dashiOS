/**
 * read_window and acting on its numbers (agents/window-tree/), on a made-up
 * AT-SPI app shaped like Settings' Bluetooth pane: the lines, the numbers
 * kept across reads, a long list in pages, a secret never read, only a
 * critical button asked about, and a number that is gone.
 */

import { expect, test } from "bun:test";
import type { RunContext, ToolResult } from "../src/agents/context.ts";
import { runCall } from "../src/agents/lib/run/run.ts";
import { parseCall, scopeOf } from "../src/agents/tools/index.ts";
import { TreeNumbers } from "../src/agents/window-tree/index.ts";
import { R, S } from "../src/agents/window-tree/lib/roles.ts";
import { criticalOf } from "../src/agents/window-tree/lib/semantics.ts";
import type { Element } from "../src/agents/window-tree/types.ts";
import type { CompositorWindow } from "../src/compositor/index.ts";
import { FakeApp, fakeBus, LIVE, type Spec } from "./support/window-tree.ts";

const rows: Spec[] = Array.from({ length: 240 }, (_, i) => ({
  role: R.LIST_ITEM,
  name: `Device ${i + 1}`,
  actions: ["click"],
  states: [...LIVE, S.SELECTABLE],
}));

const pane = (): Spec => ({
  role: R.FRAME,
  name: "Bluetooth",
  states: [...LIVE, S.ACTIVE],
  children: [
    {
      role: R.PANEL,
      children: [
        { role: R.PUSH_BUTTON, name: "Back", actions: ["click", "focus"] },
        { role: R.HEADING, name: "Bluetooth", attributes: { level: "1" } },
        { role: R.SWITCH, name: "Bluetooth", actions: ["click"], states: [...LIVE, S.CHECKED] },
        { role: R.LABEL, name: "Devices nearby" },
        { role: R.ENTRY, name: "Name", text: "Alex's laptop", interfaces: ["EditableText"], states: [...LIVE, S.EDITABLE, S.FOCUSED, S.FOCUSABLE] },
        { role: R.PASSWORD_TEXT, name: "PIN", text: "hunter2", states: [...LIVE, S.EDITABLE] },
        { role: R.SLIDER, name: "Volume", value: { now: 50, min: 0, max: 100, step: 5 } },
        { role: R.LIST, name: "Devices", children: rows },
        { role: R.LIST_ITEM, name: "Drawn row", rect: { x: 10, y: 20, width: 100, height: 30 } },
      ],
    },
    {
      role: R.DIALOG,
      name: "Remove “AirPods”?",
      states: [...LIVE, S.MODAL],
      children: [
        { role: R.LABEL, name: "You can pair it again later." },
        { role: R.PUSH_BUTTON, name: "Cancel", actions: ["click"] },
        { role: R.PUSH_BUTTON, name: "Remove", actions: ["click"], states: [...LIVE, S.IS_DEFAULT] },
        { role: R.PUSH_BUTTON, name: "Erase All Pairings", actions: ["click"] },
      ],
    },
  ],
});

const settings: CompositorWindow = {
  id: 3,
  appId: "dev.dashi.settings",
  title: "Bluetooth",
  pid: 40,
  focused: false,
  state: "normal",
  frame: { x: 0, y: 0, width: 800, height: 600 },
  titleBar: 0,
} as CompositorWindow;

function setup(answer = true) {
  const app = new FakeApp(pane());
  const sent: unknown[] = [];
  const asked: string[] = [];
  const ctx = {
    compositor: { windows: async () => [settings] },
    hands: { send: async (_w: unknown, payload: unknown) => void sent.push(payload) },
    desktop: { appShortcut: async () => false },
    agent: "Claude",
    status: () => {},
    mayName: () => true,
    signal: new AbortController().signal,
    trees: {
      bus: async () => fakeBus(app),
      numbers: new TreeNumbers(),
      personOnly: () => null,
      yes: async (question: { summary: string }) => {
        asked.push(question.summary);
        return answer;
      },
    },
  } as unknown as RunContext;
  return { app, ctx, sent, asked };
}

const words = (result: ToolResult): string => result.content.map((part) => ("text" in part ? part.text : "")).join("");
const numberOf = (text: string, line: string): number => Number(new RegExp(`\\[(\\d+)\\] ${line.replace(/[()[\]]/g, "\\$&")}`).exec(text)?.[1]);

test("a window reads as read_page's lines, nested, with what each element is and holds", async () => {
  const { ctx, app } = setup();
  const text = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  expect(text).toContain('[1] button "Back"');
  expect(text).toContain("# Bluetooth");
  expect(text).toContain('switch "Bluetooth" (on)');
  expect(text).toContain("Devices nearby");
  expect(text).toContain('textbox "Name" value="Alex\'s laptop" (focused, caret 2)');
  expect(text).toContain('slider "Volume" value=50 (0–100)');
  // The secret says whether it is filled; its text was never asked for.
  expect(text).toContain('password field "PIN" (filled: yes)');
  expect(text).not.toContain("hunter2");
  expect(app.asked.filter((call) => call.startsWith("PIN") && call.includes("GetText"))).toEqual([]);
  // A sheet is marked; its default button is primary, and only what loses work for good is critical.
  expect(text).toContain('dialog "Remove “AirPods”?" (modal)');
  expect(text).toMatch(/\[\d+\] button "Remove" \(primary\)\n/);
  expect(text).toMatch(/\[\d+\] button "Erase All Pairings" \(critical: loses work\)/);
  expect(text).toMatch(/\[\d+\] button "Cancel"\n/);
});

test("a long list gives a page of rows and the call for the next; numbers stay across reads", async () => {
  const { ctx } = setup();
  const first = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  const list = numberOf(first, 'list "Devices"');
  expect(first).toContain(`(240 rows; rows 1–40 here; next: read_window {"window":"w3","list":${list},"from":40})`);
  expect(first).toContain('list item "Device 40"');
  expect(first).not.toContain('"Device 41"');
  const again = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  expect(numberOf(again, 'list "Devices"')).toBe(list);
  expect(numberOf(again, 'button "Back"')).toBe(numberOf(first, 'button "Back"'));
  const page = words(await runCall({ name: "read_window", window: 3, list, from: 40 }, ctx));
  expect(page).toContain('list item "Device 41"');
  expect(page).toContain('"Device 80"');
  expect(page).not.toContain('"Device 81"');
  expect(page).toContain('"from":80');
});

test("a click uses the element's own action; one with none is clicked at its centre by the agent's pointer", async () => {
  const { ctx, app, sent } = setup();
  const text = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  const toggle = numberOf(text, 'switch "Bluetooth"');
  const clicked = words(await runCall({ name: "click_element", ref: toggle, tab: null, window: 3 }, ctx));
  expect(clicked).toContain("by its “click” action; nothing moved on screen");
  expect(clicked).toContain('Now: switch "Bluetooth" (on)');
  expect(app.asked).toContain("Bluetooth Action.DoAction [0]");
  expect(sent).toEqual([]);
  const drawn = numberOf(text, 'list item "Drawn row"');
  await runCall({ name: "click_element", ref: drawn, tab: null, window: 3 }, ctx);
  expect(sent).toEqual([{ pointer: { x: 60, y: 35 }, action: "click", button: "left" }]);
});

test("only a critical button waits for the person's yes; the rest just runs", async () => {
  const { ctx, app, asked } = setup(false);
  const text = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  const remove = await runCall({ name: "click_element", ref: numberOf(text, 'button "Remove"'), tab: null, window: 3 }, ctx);
  expect(remove.isError).toBeUndefined();
  expect(asked).toEqual([]);
  const erase = await runCall({ name: "click_element", ref: numberOf(text, 'button "Erase All Pairings"'), tab: null, window: 3 }, ctx);
  expect(erase.isError).toBe(true);
  expect(asked).toEqual(["press “Erase All Pairings” in “Bluetooth”"]);
  expect(app.asked.some((call) => call.startsWith("Erase All Pairings Action.DoAction"))).toBe(false);
});

test("a number whose element is gone says so, with the tree around where it was", async () => {
  const { ctx, app } = setup();
  const text = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  app.gone.add(app.named("Back").path);
  const result = await runCall({ name: "click_element", ref: numberOf(text, 'button "Back"'), tab: null, window: 3 }, ctx);
  expect(result.isError).toBe(true);
  expect(words(result)).toContain('(button "Back") is no longer in w3');
  expect(words(result)).toContain('switch "Bluetooth" (on)');
});

test("fill_element sets a field's text, never a secret's; a slider steps", async () => {
  const { ctx, app } = setup();
  const text = words(await runCall({ name: "read_window", window: 3, list: null, from: 0 }, ctx));
  const filled = words(await runCall({ name: "fill_element", ref: numberOf(text, 'textbox "Name"'), text: "Kim's laptop", tab: null, window: 3 }, ctx));
  expect(filled).toContain("through its editable text");
  expect(app.asked).toContain(`Name EditableText.SetTextContents ["Kim's laptop"]`);
  const secret = await runCall({ name: "fill_element", ref: numberOf(text, 'password field "PIN"'), text: "1234", tab: null, window: 3 }, ctx);
  expect(words(secret)).toContain("sign_in and fill_code fill those");
  await runCall({ name: "act_on_element", ref: numberOf(text, 'slider "Volume"'), window: 3, action: "increment" }, ctx);
  expect(app.asked.some((call) => call.startsWith("Volume DBus.Properties.Set") || (call.includes("Value") && call.includes("Set")))).toBe(true);
});

test("with a window the website tools need “act”, and read_window “see”", () => {
  const click = parseCall({ name: "click_element", arguments: { ref: 4, window: "w3" } });
  expect(click).toEqual({ name: "click_element", ref: 4, tab: null, window: 3 });
  if ("name" in click) expect(scopeOf(click)).toBe("act");
  const page = parseCall({ name: "click_element", arguments: { ref: 4 } });
  if ("name" in page) expect(scopeOf(page)).toBe("web");
  const read = parseCall({ name: "read_window", arguments: { window: "w3", list: 7, from: 40 } });
  expect(read).toEqual({ name: "read_window", window: 3, list: 7, from: 40 });
  if ("name" in read) expect(scopeOf(read)).toBe("see");
  expect(parseCall({ name: "scroll_page", arguments: { window: "w3" } })).toHaveProperty("arguments");
});

const button = (name: string, attributes: Record<string, string> = {}): Element => ({
  key: name,
  role: R.PUSH_BUTTON,
  name,
  description: "",
  states: [],
  attributes,
  interfaces: [],
  actions: ["click"],
  childCount: 0,
  children: [],
});

test("what is critical: paying, a secret, losing work for good, the system, sending as the person", () => {
  const plain = { inSheet: false, secretFilled: false };
  const kinds = (names: string[], hints = plain) => names.map((name) => criticalOf(button(name), hints));
  expect(kinds(["Pay $12.00", "Buy", "Comprar"])).toEqual(["pays", "pays", "pays"]);
  expect(kinds(["Don't Save", "Delete Immediately", "Empty Trash", "Vaciar papelera", "Discard Changes"])).toEqual(Array(5).fill("loses work"));
  expect(kinds(["Install", "Uninstall", "Update All", "Instalar"])).toEqual(Array(4).fill("system"));
  expect(kinds(["Send", "Reply All", "Enviar", "Decline"])).toEqual(Array(4).fill("sends"));
  // Into the Trash, closing, removing a device, saving: they just run.
  expect(kinds(["Delete", "Move to Trash", "Remove", "Close", "Save", "OK", "Cancel"])).toEqual(Array(7).fill(null));
  // "Sign in" is a sign-in with a secret only beside a filled password field.
  expect(kinds(["Sign in"])).toEqual([null]);
  expect(kinds(["Sign in", "Iniciar sesión"], { inSheet: false, secretFilled: true })).toEqual(["secret", "secret"]);
  // The toolkit's word wins.
  expect(criticalOf(button("Go", { critical: "sends" }), plain)).toBe("sends");
  expect(criticalOf(button("Go", { destructive: "true" }), plain)).toBe("loses work");
});
