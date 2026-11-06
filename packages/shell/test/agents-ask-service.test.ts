import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnswererChoice } from "../src/agents/ask/answerer.ts";
import { HistoryLog } from "../src/agents/ask/history.ts";
import { modelKeys } from "../src/agents/ask/keys.ts";
import { TurnWatch } from "../src/agents/ask/now.ts";
import { startAsk } from "../src/agents/ask/service.ts";
import { AgentStore } from "../src/agents/presence.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { keyWords, modelWords } from "../src/settings-app/panes/agents-answer.tsx";
import { readSettings } from "../src/settings-app/store.ts";

test("Settings › Agents says where Claude's key is and what model runs here", () => {
  expect(keyWords("vault")).toBe("In your vault. Claude never sees it.");
  expect(keyWords("none")).toContain("“anthropic” for api.anthropic.com");
  expect(keyWords(null)).toBe("Looking…");
  expect(modelWords(null, undefined)).toContain("No local model is running");
  expect(modelWords([], undefined)).toBe("No model is installed yet.");
  expect(modelWords(["qwen3:8b", "llama3.2:3b"], "llama3.2:3b")).toBe("llama3.2:3b, on this computer. Nothing you ask leaves it.");
});

test("settings.json agents: only the choices and model names it knows are read", () => {
  expect(readSettings({ agents: { answerer: "local", localModel: "qwen3:8b" } }).agents).toEqual({ answerer: "local", localModel: "qwen3:8b" });
  expect(readSettings({ agents: { answerer: "gpt", localModel: "../x" } }).agents).toEqual({});
  expect(readSettings({}).agents).toEqual({});
});

function settings(answerer?: AnswererChoice) {
  let data = { agents: answerer ? { answerer } : {} };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => ({ data }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pick(next: AnswererChoice) {
      data = { agents: { answerer: next } };
      for (const listener of listeners) listener();
    },
  };
}

function start(store = settings(), fetch?: (url: string, init: RequestInit) => Promise<Response>) {
  const dir = mkdtempSync(join(tmpdir(), "dashi-ask-"));
  const agents = new AgentStore();
  const stopped: number[] = [];
  const ask = startAsk({
    settings: store,
    agents,
    turns: new TurnWatch(),
    actions: () => TOOL_ACTIONS,
    runApproved: async () => ({ ok: true, text: "" }),
    runAsPerson: async () => ({ ok: true, text: "" }),
    personPressed: async () => true,
    settingNow: () => null,
    focus: async () => {},
    stopAgent: (id) => stopped.push(id),
    openSettings: () => {},
    keys: modelKeys(null, {}),
    history: new HistoryLog(dir),
    ...(fetch ? { fetch } : {}),
  });
  return { ask, agents, stopped, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("nothing picked: no answerer, and ⇥ will offer to set one up; a pick shows at once", () => {
  const store = settings();
  const { ask, done } = start(store);
  const first = ask.launcher.getSnapshot();
  expect(first).toMatchObject({ answerer: null, unset: true, now: [] });
  // The same snapshot until something under it changes (React reads it on every render).
  expect(ask.launcher.getSnapshot()).toBe(first);
  let heard = 0;
  const off = ask.launcher.subscribe(() => heard++);
  store.pick("local");
  expect(heard).toBe(1);
  expect(ask.launcher.getSnapshot()).toMatchObject({ answerer: { id: "local" }, unset: false });
  store.pick("none");
  expect(ask.launcher.getSnapshot()).toMatchObject({ answerer: null, unset: false });
  expect(ask.launcher.ask("dark mode and hide the dock")).toBeNull();
  off();
  done();
});

test("an agent connected over MCP is in Now, and Stop cuts it off", () => {
  const { ask, agents, stopped, done } = start(settings("claude"));
  agents.set([{ id: 4, name: "codex", status: "Sorting Downloads", scopes: [] }]);
  const [item] = ask.launcher.getSnapshot().now;
  expect(item).toEqual({ kind: "agent", id: 4, name: "codex", status: "Sorting Downloads" });
  if (item) ask.launcher.stop(item);
  expect(stopped).toEqual([4]);
  done();
});

test("Claude with no key: the Ask fails with where the key goes, and nothing is sent", async () => {
  const sent: string[] = [];
  const { ask, done } = start(settings("claude"), async (url) => {
    sent.push(url);
    return Response.json({});
  });
  const id = ask.launcher.ask("dark mode and hide the dock");
  await new Promise((resolve) => setTimeout(resolve, 5));
  const task = ask.launcher.getSnapshot().tasks.find((each) => each.id === id);
  expect(task?.phase).toBe("failed");
  expect(task?.failure?.kind).toBe("no-key");
  expect(sent).toEqual([]);
  expect(await ask.status.keyPlace()).toBe("none");
  done();
});
