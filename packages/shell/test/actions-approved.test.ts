import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startActions } from "../src/actions/start.ts";
import type { Call } from "../src/agents/tools/types.ts";
import { KEYMAP } from "../src/keymap.ts";

// A plan's step the person approved (agents/ask/tasks.ts): run as that press's Allow Once, logged as the agent's, in its task.

let state: string;
const before = process.env.XDG_STATE_HOME;
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "dashi-approved-"));
  process.env.XDG_STATE_HOME = state;
});
afterEach(() => {
  rmSync(state, { recursive: true, force: true });
  if (before === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = before;
});

function actions(calls: Call[]) {
  return startActions({
    compositor: null,
    agents: {
      runAsPerson: async (call) => {
        calls.push(call);
        return { content: [{ type: "text", text: "Dark Mode is on." }] };
      },
      desktop: {} as never,
    },
    confirmPerson: async () => false,
    entries: () => [],
    launch: () => null,
    appMenus: { published: () => [], onPublished: () => () => {}, select: () => false },
    appName: () => "",
    arrange: null,
    runMenu: async () => {},
    openSettings: () => {},
    keymap: KEYMAP,
    serveLinks: false,
  });
}

test("an approved step runs the tool and is logged as the agent's, with its task", async () => {
  const calls: Call[] = [];
  const started = actions(calls);
  const action = started.registry.get("dashi://tool/set-setting");
  if (!action) throw new Error("no set-setting");
  const outcome = await started.runApproved(action, { name: "dark_mode", value: true }, { agent: "Claude", task: "ask-1" });
  expect(outcome).toEqual({ ok: true, text: "Dark Mode is on." });
  expect(calls).toEqual([{ name: "set_setting", setting: "dark_mode", value: true }]);
  const [line] = readFileSync(join(state, "dashi/agents/activity.jsonl"), "utf8").split("\n");
  expect(JSON.parse(line ?? "{}")).toMatchObject({ agent: "Claude", tool: "dashi://tool/set-setting", outcome: "ok", task: "ask-1" });
  started.close();
});

test("only agents' tools run so, and their arguments are checked", async () => {
  const calls: Call[] = [];
  const started = actions(calls);
  const lock = started.registry.get("dashi://dashi/lock-screen");
  const setting = started.registry.get("dashi://tool/set-setting");
  if (!lock || !setting) throw new Error("missing actions");
  expect(await started.runApproved(lock, {}, { agent: "Claude", task: "ask-1" })).toEqual({ ok: false, error: "Agents can't use this." });
  expect((await started.runApproved(setting, { name: "dark_mode", value: "yes" }, { agent: "Claude", task: "ask-1" })).ok).toBe(false);
  expect(calls).toEqual([]);
  started.close();
});
