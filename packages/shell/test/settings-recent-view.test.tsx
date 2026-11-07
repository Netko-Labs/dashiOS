import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "@dashi/ui";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { actingAs } from "../src/acting.ts";
import { Grants } from "../src/agents/consent.ts";
import { AgentStore } from "../src/agents/presence.ts";
import { FlagsStore } from "../src/control-center/flags.ts";
import type { PaneContext } from "../src/settings-app/context.ts";
import { FindFocus, findSettings, moveFound } from "../src/settings-app/find.ts";
import { AgentsPane } from "../src/settings-app/panes/agents.tsx";
import { Nav, type PaneId } from "../src/settings-app/panes.ts";
import { agentCards } from "../src/settings-app/privacy-words.ts";
import { PaneStoresContext } from "../src/settings-app/setting.tsx";
import { RowFocus } from "../src/settings-app/spot.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { SettingsWindow } from "../src/settings-app/view.tsx";

// Recently changed, search in the header strip, and Agents as a consent dashboard, on a stand-in for the Metal host.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-recent-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 20));

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(<Appearance dark={false}>{tree}</Appearance>, transport);
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
    has: (testID: string): boolean => Boolean(root.nodeId(testID)),
    press: (testID: string) => emit({ type: "press", nodeId: node(testID) }),
    type: (testID: string, value: string) => emit({ type: "change", nodeId: node(testID), value }),
    key: (testID: string, value: "Escape" | "ArrowUp" | "ArrowDown") => emit({ type: "key", nodeId: node(testID), value }),
    submit: (testID: string) => emit({ type: "submit", nodeId: node(testID), value: "" }),
  };
}

function setup() {
  const settings = new SettingsStore(join(dir, `settings-${Math.random()}.json`));
  const flags = new FlagsStore(null);
  const grants = new Grants(null);
  const agents = new AgentStore();
  const shown: string[] = [];
  const nav = new Nav();
  const ctx = {
    settings,
    flags,
    grants,
    agents,
    home: "/home/alexk",
    services: {},
    show: (pane: PaneId, row?: string) => {
      nav.select(pane);
      shown.push(row ? `${pane}/${row}` : pane);
    },
  } as unknown as PaneContext;
  return { settings, flags, grants, agents, ctx, nav, shown };
}

test("search finds rows by their words and panes by theirs, best first", () => {
  expect(findSettings("")).toEqual([]);
  expect(findSettings("charge").map((found) => found.id)).toContain("battery/charge-limit");
  expect(findSettings("night")[0]?.id).toBe("displays/night-shift");
  expect(findSettings("blue")[0]).toMatchObject({ id: "bluetooth", label: "Bluetooth" });
  expect(findSettings("dark mode").map((found) => found.id)).toContain("appearance/dark-mode");
  expect(findSettings("graphics mode", (pane) => pane.id !== "graphics").some((found) => found.pane === "graphics")).toBe(false);
  expect(findSettings("zzqx")).toEqual([]);
  expect([moveFound(0, -1, 3), moveFound(2, 1, 3), moveFound(1, 1, 3), moveFound(0, 1, 0)]).toEqual([0, 2, 2, -1]);
});

test("typing in the header strip lists what it finds in the sidebar; Return opens the row, Esc brings the panes back", async () => {
  const { ctx, nav } = setup();
  const focus = new RowFocus();
  const find = new FindFocus();
  const view = await mount(<SettingsWindow ctx={ctx} nav={nav} spots={{ focus }} find={find} />);
  expect(view.has("settings-search")).toBe(true);
  expect(view.has("settings-sidebar-panes")).toBe(true);

  await view.type("settings-search", "text size");
  expect(view.has("settings-sidebar-panes")).toBe(false);
  expect(view.has("found:appearance/text-size")).toBe(true);
  await view.submit("settings-search");
  expect(nav.getSnapshot()).toBe("appearance");
  expect(focus.getSnapshot()).toMatchObject({ pane: "appearance", row: "text-size" });

  await view.type("settings-search", "qqqzz");
  expect(view.has("settings-search-none")).toBe(true);
  await view.key("settings-search", "Escape");
  expect(view.has("settings-sidebar-panes")).toBe(true);

  // ❖F makes the field again, asking for the keyboard.
  const before = view.root.nodeId("settings-search");
  find.request();
  await settle();
  expect(view.root.nodeId("settings-search")).not.toBe(before);
  view.root.unmount();
});

test("Recently changed lists who changed what, agents by name, each with Undo while it can be", async () => {
  const { ctx, nav, settings, shown } = setup();
  settings.patch("appearance", { textSize: 1.15 });
  actingAs({ agent: "claude", key: "/usr/bin/claude" }, () => settings.patch("clock", { showDate: false }));
  const view = await mount(
    <PaneStoresContext.Provider value={{ settings, flags: ctx.flags }}>
      <SettingsWindow ctx={ctx} nav={nav} />
    </PaneStoresContext.Provider>,
  );
  await view.press("settings-recent");
  expect(nav.getSnapshot()).toBe("recent");
  const [date, text] = settings.changes.getSnapshot();
  if (!date || !text) throw new Error("no entries");
  expect(view.has(`recent:${date.id}`)).toBe(true);
  expect(view.has("change-by-agent")).toBe(true);
  expect(view.has(`recent:${text.id}:undo`)).toBe(true);

  await view.press(`recent:${text.id}:undo`);
  expect(settings.getSnapshot().data.appearance.textSize).toBeUndefined();
  expect(view.has(`recent:${text.id}:undo`)).toBe(false);
  // The agent's change is still there to undo; ❖Z would now redo the text size.
  expect(view.has(`recent:${date.id}:undo`)).toBe(true);
  expect(settings.undo.state.undoName).toBe("Text Size");
  view.root.unmount();
  expect(shown).toEqual([]);
});

test("with nothing changed, Recently changed says so", async () => {
  const { ctx, nav } = setup();
  nav.select("recent");
  const view = await mount(<SettingsWindow ctx={ctx} nav={nav} />);
  expect(view.has("recent-none")).toBe(true);
  view.root.unmount();
});

test("Agents lists each agent: connected now, what it may do riskiest first, what it changed; Revoke and Undo", async () => {
  const { ctx, settings, grants, agents } = setup();
  grants.set("/usr/bin/claude", new Set(["see", "signin", "settings"]), 1_760_000_000);
  agents.set([{ id: 1, name: "claude", key: "/usr/bin/claude", status: "Connected", scopes: [] }]);
  agents.set([...agents.getSnapshot(), { id: 2, name: "codex", key: "/usr/bin/codex", status: "Connected", scopes: [] }]);
  actingAs({ agent: "claude", key: "/usr/bin/claude" }, () => settings.patch("appearance", { reduceMotion: true }));

  const cards = agentCards(grants.entries(), agents.getSnapshot(), "/home/alexk");
  expect(cards.map((card) => [card.title, card.connected, card.scopes.map((scope) => scope.scope)])).toEqual([
    ["claude", true, ["signin", "settings", "see"]],
    ["codex", true, []],
  ]);

  const view = await mount(<AgentsPane ctx={ctx} />);
  expect(view.has("agent:/usr/bin/claude")).toBe(true);
  expect(view.has("agent:/usr/bin/codex")).toBe(true);
  expect(view.has("agent-connected")).toBe(true);
  expect(view.has("agent-scope:/usr/bin/claude:signin")).toBe(true);
  // What it changed, with Undo.
  const [motion] = settings.changes.getSnapshot();
  expect(view.has(`agent-change:${motion?.id}`)).toBe(true);
  await view.press(`agent-change:${motion?.id}:undo`);
  expect(settings.getSnapshot().data.appearance.reduceMotion).toBeUndefined();

  // One permission back, then put back with Undo.
  await view.press("agent-revoke:/usr/bin/claude:signin");
  expect(grants.get("/usr/bin/claude")).toEqual(new Set(["see", "settings"]));
  expect(view.has("agent-revoked:/usr/bin/claude")).toBe(true);
  await view.press("agent-revoked-undo:/usr/bin/claude");
  expect(grants.get("/usr/bin/claude")).toEqual(new Set(["see", "settings", "signin"]));
  expect(grants.entries()[0]?.since.signin).toBe(1_760_000_000);

  // All of them.
  await view.press("agent-revoke-all:/usr/bin/claude");
  expect(grants.entries()).toEqual([]);
  expect(view.has("agent-scope:/usr/bin/claude:see")).toBe(false);
  // Still connected, so still listed: it asks before anything now.
  expect(view.has("agent:/usr/bin/claude")).toBe(true);
  view.root.unmount();
});

test("with no agent, Agents says how one gets listed", async () => {
  const { ctx } = setup();
  const view = await mount(<AgentsPane ctx={ctx} />);
  expect(view.has("agents-none")).toBe(true);
  view.root.unmount();
});
