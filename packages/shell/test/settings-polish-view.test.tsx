import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { readHistory } from "../src/agents/ask/history.ts";
import { DEFAULT_LEFT_OUT } from "../src/clipboard/privacy.ts";
import { HistoryRow } from "../src/settings-app/panes/agents-answer.tsx";
import { ClipboardSection } from "../src/settings-app/panes/clipboard-parts.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { settle } from "./support/time.ts";

// Settings' clipboard list and the agents' history on a stand-in for the Metal host.

const dir = mkdtempSync(join(tmpdir(), "dashi-settings-polish-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(tree, transport);
  await settle();
  const has = (testID: string): boolean => root.nodeId(testID) !== null && root.nodeId(testID) !== undefined;
  return {
    has,
    press: async (testID: string): Promise<void> => {
      const nodeId = root.nodeId(testID);
      if (!nodeId) throw new Error(`no node ${testID}`);
      for (const listener of listeners) listener({ type: "press", nodeId });
      await settle();
    },
  };
}

test("each left-out app is listed once, and Remove takes all its ids", async () => {
  const settings = new SettingsStore(join(dir, "settings.json"));
  const installed = (id: string) => (id === "com.bitwarden.desktop" ? { name: "Bitwarden", icon: "/bitwarden.svg" } : undefined);
  const view = await mount(<ClipboardSection settings={settings} installed={installed} />);
  const rows = DEFAULT_LEFT_OUT.filter((id) => view.has(`clipboard-left-out:${id}`));
  expect(rows).toEqual(["org.keepassxc.KeePassXC", "Bitwarden", "1Password", "org.gnome.seahorse.Application"]);
  await view.press("clipboard-left-out-remove:Bitwarden");
  expect(settings.getSnapshot().data.clipboard.leftOut).toEqual([
    "org.keepassxc.KeePassXC",
    "keepassxc",
    "1Password",
    "1password",
    "org.gnome.seahorse.Application",
    "seahorse",
  ]);
});

test("an agent's connections in quick succession are one row that opens to list each", async () => {
  const call = (time: number, tool: string) => JSON.stringify({ time, agent: "Remote agent", claims: null, tool, outcome: "ok" });
  const end = (time: number) => JSON.stringify({ time, agent: "Remote agent", claims: null, tool: null, outcome: "disconnected" });
  const [entry] = readHistory({ tasks: "", activity: [call(10, "screenshot"), end(11), call(20, "click"), end(21)].join("\n") });
  if (!entry) throw new Error("no entry");
  const view = await mount(<HistoryRow entry={entry} onUndo={() => {}} />);
  expect(view.has("agents-history:session:1+")).toBe(true);
  expect(view.has("agents-history-part:session:2")).toBe(false);
  await view.press("agents-history-open:session:1+");
  expect(view.has("agents-history-part:session:1")).toBe(true);
  expect(view.has("agents-history-part:session:2")).toBe(true);
});
