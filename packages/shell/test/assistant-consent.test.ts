/**
 * Consent when the assistant is the person's own (agents/lib/session/;
 * decisions.md D260): on a real connection with the assistant's policy,
 * only the critical list asks; closing a window, reading, ordinary calls
 * just run; the critical tools keep their own sheet, or ask on the
 * launcher's line while the turn was typed; the cap refuses in words; and
 * nothing runs while locked.
 */

import { expect, test } from "bun:test";
import { ASKS_EVERY_TIME } from "../src/actions/tools.ts";
import { SCOPES } from "../src/agents/consent.ts";
import { Session } from "../src/agents/lib/session/session.ts";
import type { SessionContext, TaskPolicy } from "../src/agents/lib/session/session-types.ts";
import type { Confirm, PersonAnswer, PersonAsk } from "../src/agents/presence.ts";
import { SiteGrants } from "../src/agents/sites.ts";
import { TOOLS } from "../src/agents/tools/index.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { flush } from "./support/time.ts";

const WINDOW = {
  id: 3,
  appId: "dev.dashi.terminal",
  title: "Terminal",
  pid: 10,
  focused: true,
  state: "normal" as const,
  frame: { x: 0, y: 0, width: 9, height: 9 },
  titleBar: 0,
};

function assistantSession(answer: PersonAnswer = { text: "Yes.", by: "voice" }) {
  const sent: Array<{ id?: number; result?: { isError?: boolean; content: Array<{ text: string }> } }> = [];
  const questions: PersonAsk[] = [];
  const confirms: Confirm[] = [];
  const sheets: string[] = [];
  const said: string[] = [];
  const state = { refuses: null as string | null, locked: false, line: null as boolean | null };
  const lines: string[] = [];
  const requests: string[] = [];
  const ui = {
    ask: async () => {
      sheets.push("scopes");
      return { allow: "deny" as const, scopes: [] };
    },
    confirm: async (confirm: Confirm) => {
      confirms.push(confirm);
      return false;
    },
    allowSite: async () => {
      sheets.push("site");
      return "deny" as const;
    },
    question: async (ask: PersonAsk) => {
      questions.push(ask);
      return answer;
    },
    signIn: async () => ({ allow: "deny" as const, login: null }),
    turn: async () => false,
    dismiss: () => {},
    stopped: () => {},
    whenNoSheet: async () => {},
  };
  const ctx = {
    compositor: fakeCompositor(
      async (method) => {
        requests.push(method);
        return {};
      },
      { windows: async () => [WINDOW] },
    ),
    ui,
    desktop: { forceQuit: { apps: () => [{ pid: 10, appId: WINDOW.appId, name: "Terminal", windows: [WINDOW] }] } },
    grants: { get: () => new Set(), set: () => {} },
    sites: new SiteGrants(null),
    get lock() {
      return { isLocked: state.locked };
    },
    publish: () => {},
    arrangement: () => null,
    secrets: {
      sources: () => [],
      atspi: async () => null,
      handedOver: new Set<number>(),
      filled: new Map(),
      vault: { cards: async () => [], pay: async () => Promise.reject(new Error("no")) },
    },
  } as unknown as SessionContext;
  const policy: TaskPolicy = {
    granted: SCOPES.map((scope) => scope.id),
    refused: [],
    window: null,
    name: "Dashi",
    sites: new Set(),
    assistant: {
      refuses: () => state.refuses,
      site: (site) => said.push(site),
      confirm: (question) => {
        if (state.line === null) return null;
        lines.push(question.summary);
        return Promise.resolve(state.line);
      },
    },
  };
  const session = new Session(
    1,
    { name: "Dashi", detail: "", key: "dashi", remote: false },
    {
      write: (data) => {
        sent.push(JSON.parse(new TextDecoder().decode(data).trim()));
        return data.byteLength;
      },
      terminate: () => {},
    },
    ctx,
    () => {},
    true,
    { id: "talk1", policy },
  );
  let next = 1;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const id = next++;
    session.receive(new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })}\n`));
    await flush();
    return sent.find((message) => message.id === id)?.result ?? null;
  };
  return { call, questions, confirms, sheets, said, state, requests, policy, lines };
}

test("the critical list that asks on a sheet of its own (D260): force quit and software; trash and the clipboard history don't", () => {
  expect([...ASKS_EVERY_TIME].sort()).toEqual(["force_quit_app", "request_software_install", "request_software_update"]);
});

test("108 tools, and none of the tools engineer's new ones asks on a sheet of its own", () => {
  expect(TOOLS).toHaveLength(108);
});

test("reading and ordinary calls just run, with no sheet and no question", async () => {
  const h = assistantSession();
  expect((await h.call("list_windows"))?.isError).toBeUndefined();
  expect((await h.call("focus_window", { window: "w3" }))?.isError).toBeUndefined();
  expect(h.sheets).toEqual([]);
  expect(h.questions).toEqual([]);
});

test("closing a window just runs: no question, no sheet (D260)", async () => {
  const h = assistantSession();
  expect((await h.call("close_window", { window: "w3" }))?.isError).toBeUndefined();
  expect(h.questions).toEqual([]);
  expect(h.confirms).toEqual([]);
  expect(h.requests).toContain("close");
});

test("a critical step of a typed turn asks on the launcher's line, not the sheet", async () => {
  const h = assistantSession();
  h.state.line = false;
  await h.call("force_quit_app", { window: "w3" });
  expect(h.lines).toHaveLength(1);
  expect(h.confirms).toEqual([]);
});

test("a tool that asks every time keeps its own sheet, never the spoken yes", async () => {
  const h = assistantSession();
  await h.call("force_quit_app", { window: "w3" });
  expect(h.confirms).toHaveLength(1);
  expect(h.questions).toEqual([]);
});

test("at the cap a call is refused in the gate's words; locked, nothing runs and nobody is asked", async () => {
  const h = assistantSession();
  h.state.refuses = "That was 25 steps.";
  expect(await h.call("list_windows")).toMatchObject({ isError: true, content: [{ text: "That was 25 steps." }] });
  h.state.refuses = null;
  h.state.locked = true;
  expect((await h.call("close_window", { window: "w3" }))?.isError).toBe(true);
  expect(h.questions).toEqual([]);
});
