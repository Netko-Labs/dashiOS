import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipboardActions } from "../src/clipboard/actions.ts";
import { ClipboardHistory } from "../src/clipboard/history.ts";
import { historyScope, type ScopeDeps, snippetsScope } from "../src/clipboard/scope.ts";
import { SnippetStore } from "../src/clipboard/snippets.ts";
import type { LauncherWorldStore } from "../src/launcher/host.ts";
import { LauncherKeys } from "../src/launcher/keys.ts";
import type { WorldSnapshot } from "../src/launcher/world.ts";
import { mount, settle, unmountLauncher } from "./launcher-harness.tsx";

// The clipboard history and the snippets as launcher scopes: the same panel
// behind a chip, ↩ pastes into the window under the launcher, ❖K has Pin,
// Delete and Clear History, Esc leaves the scope (or closes, opened for it).

const dirs: string[] = [];
afterEach(() => {
  unmountLauncher();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "dashi-launcher-clipboard-"));
  dirs.push(dir);
  const history = new ClipboardHistory({ dir: join(dir, "clipboard"), sync: true });
  const snippets = new SnippetStore(join(dir, "snippets.json"));
  const log: string[] = [];
  const deps: ScopeDeps = {
    history,
    snippets,
    enabled: () => true,
    target: () => NOTES,
    onChange: () => () => {},
    imagePath: () => null,
    paste: async (entry, to) => {
      log.push(`paste ${entry.text} into ${to.appName}`);
      return true;
    },
    copy: async (entry) => {
      log.push(`copy ${entry.text}`);
      return true;
    },
    pasteSnippet: async (text, to) => {
      log.push(`paste snippet ${text} into ${to.appName}`);
      return true;
    },
    copySnippet: async () => true,
    openSettings: () => void log.push("settings"),
  };
  const scopes = [historyScope(deps), snippetsScope(deps)];
  history.add({ kind: "text", mime: "text/plain;charset=utf-8", text: "Calle de la Luna 12, 2º B", app: "Mail" });
  history.add({ kind: "text", mime: "text/plain;charset=utf-8", text: "git push origin release/0.4.0", app: "Terminal" });
  return { history, snippets, log, scopes };
}

const NOTES = { id: 7, appId: "dev.dashi.notes", appName: "Notes" };
const rowsOf = (history: ClipboardHistory) => history.getSnapshot().entries.map((entry) => `clip:${entry.id}`);

test("⌥❖V opens the history alone: the chip, newest first, ↩ pastes into the window under it, Esc closes", async () => {
  const { history, log, scopes } = setup();
  const [newest, older] = rowsOf(history) as [string, string];
  const launcher = await mount({ entries: [], scopes, scope: "clipboard" }, [newest, older]);
  expect(launcher.has("launcher:chip")).toBe(true);
  expect(launcher.tree()).toContain("Clipboard");
  expect(launcher.tree()).toContain("Paste into Notes");
  expect(launcher.rows().ids).toEqual([newest, older]);
  expect(launcher.rows().selected).toBe(newest);
  await launcher.type("luna");
  expect(launcher.rows().ids).toEqual([older]);
  await launcher.enter();
  expect(log).toEqual(["paste Calle de la Luna 12, 2º B into Notes"]);
  expect(launcher.closed.length).toBe(1);
  launcher.unmount();
  const again = await mount({ entries: [], scopes, scope: "clipboard" }, [newest, older]);
  await again.key("Escape");
  expect(again.closed.length).toBe(1);
});

test("❖C copies and stays; ❖K has Pin, Delete and Clear History, which asks in place", async () => {
  const { history, log, scopes } = setup();
  const keys = new LauncherKeys();
  const [newest, older] = rowsOf(history) as [string, string];
  const launcher = await mount({ entries: [], scopes, scope: "clipboard", keys }, [
    newest,
    older,
    "verb:paste",
    "verb:copy",
    "verb:pin",
    "verb:delete",
    "verb:clear",
  ]);
  keys.binding("launcher-copy");
  await settle();
  expect(log).toEqual(["copy git push origin release/0.4.0"]);
  expect(launcher.closed).toEqual([]);
  keys.binding("launcher-actions");
  await settle();
  expect(launcher.rows().ids).toEqual(["verb:paste", "verb:copy", "verb:pin", "verb:delete", "verb:clear"]);
  await launcher.type("pin");
  await launcher.enter();
  expect(history.getSnapshot().entries[0]?.pinned).toBe(true);
  expect(launcher.tree()).toContain("Pinned");
  keys.binding("launcher-actions");
  await settle();
  await launcher.type("clear");
  await launcher.enter();
  expect(launcher.tree()).toContain("Clear all 2 copies, pinned ones too?");
  expect(history.getSnapshot().entries.length).toBe(2);
  await launcher.enter();
  expect(history.getSnapshot().entries.length).toBe(0);
  expect(launcher.tree()).toContain("Nothing copied yet");
});

test("chosen in the launcher, Clipboard History is entered in place; Esc goes back to the search", async () => {
  const { scopes } = setup();
  const actions = clipboardActions({
    open: () => {
      throw new Error("the launcher enters it in place");
    },
    enabled: () => true,
    setEnabled: () => {},
    count: () => 2,
    clear: () => {},
    confirm: async () => false,
  });
  const snapshot: WorldSnapshot = { actions, windows: [], serial: 0 };
  const world: LauncherWorldStore = { subscribe: () => () => {}, getSnapshot: () => snapshot };
  const ids = ["action:dashi://clipboard/history", "action:dashi://settings/keyboard/clipboard-history", "action:dashi://clipboard/clear"];
  const launcher = await mount({ entries: [], scopes, world }, ids);
  await launcher.type("clipboard");
  // The command first; the switch and Clear Clipboard History below it.
  expect(launcher.rows().ids[0]).toBe("action:dashi://clipboard/history");
  expect(launcher.rows().selected).toBe("action:dashi://clipboard/history");
  await launcher.enter();
  expect(launcher.has("launcher:chip")).toBe(true);
  expect(launcher.tree()).toContain("2 copies");
  await launcher.key("Escape");
  expect(launcher.has("launcher:chip")).toBe(false);
  expect(launcher.closed).toEqual([]);
});

test("snippets: the field adds one with ↩, then it is a row that pastes", async () => {
  const { snippets, log, scopes } = setup();
  const launcher = await mount({ entries: [], scopes, scope: "snippets" }, ["snippet:add", "snippet:;addr"]);
  await launcher.type(";addr Calle de la Luna 12");
  expect(launcher.rows().ids).toEqual(["snippet:add"]);
  await launcher.enter();
  expect(snippets.getSnapshot()).toEqual([{ keyword: ";addr", text: "Calle de la Luna 12" }]);
  expect(launcher.rows().ids).toEqual(["snippet:;addr"]);
  await launcher.enter();
  expect(log).toEqual(["paste snippet Calle de la Luna 12 into Notes"]);
});
