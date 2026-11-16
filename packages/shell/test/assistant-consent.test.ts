/**
 * Consent when the assistant is the person's own (agents/lib/session/;
 * decisions.md D148, the diagnosis's table): on a real connection with the
 * assistant's policy, what reads and what is ordinary just runs; a
 * destructive call gets one yes or no by voice; the tools that ask every
 * time keep their own sheet; a site new to the conversation is used and
 * said; the cap refuses in words; and nothing runs while locked.
 */

import { expect, test } from "bun:test";
import { SCOPES } from "../src/agents/consent.ts";
import { Session } from "../src/agents/lib/session/session.ts";
import { needsSpokenYes, SAID_NO, yesOrNo } from "../src/agents/lib/session/session-assistant.ts";
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
  const state = { refuses: null as string | null, locked: false };
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
    assistant: { refuses: () => state.refuses, site: (site) => said.push(site) },
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
  return { call, questions, confirms, sheets, said, state, requests, policy };
}

test("the tools that wait for a spoken yes are the destructive ones with no sheet of their own: four of 89", () => {
  expect(TOOLS).toHaveLength(89);
  expect(
    TOOLS.filter((tool) => needsSpokenYes(tool.name))
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(["choose_menu_item", "clear_notifications", "close_window", "dismiss_notification"]);
  expect(["force_quit_app", "trash_file", "pay", "read_page", "open_url", "set_setting"].some(needsSpokenYes)).toBe(false);
});

test("a yes is heard at the start of what was said, in English and Spanish; anything else is not a yes", () => {
  expect(["yes", "Yes, go ahead and do it.", "yeah sure", "OK", "sí, dale", "claro"].map(yesOrNo)).toEqual([true, true, true, true, true, true]);
  expect(["no", "No, wait.", "don't", "cancela", "mejor no", "no, yes"].map(yesOrNo)).toEqual([false, false, false, false, false, false]);
  expect(["the blue one", "yesterday", "", "nothing"].map(yesOrNo)).toEqual([null, null, null, null]);
});

test("reading and ordinary calls just run, with no sheet and no question", async () => {
  const h = assistantSession();
  expect((await h.call("list_windows"))?.isError).toBeUndefined();
  expect((await h.call("focus_window", { window: "w3" }))?.isError).toBeUndefined();
  expect(h.sheets).toEqual([]);
  expect(h.questions).toEqual([]);
});

test("closing a window asks once by voice, naming it; a yes closes it and a no does not", async () => {
  const yes = assistantSession({ text: "Yes, go ahead.", by: "voice" });
  expect((await yes.call("close_window", { window: "w3" }))?.isError).toBeUndefined();
  expect(yes.questions.map((ask) => [ask.question, ask.who.name])).toEqual([["Close the window “Terminal”?", "Dashi"]]);
  expect(yes.requests).toContain("close");
  for (const answer of [{ text: "no", by: "voice" as const }, { text: "hmm, which one?", by: "voice" as const }, { none: "no-answer" as const }]) {
    const no = assistantSession(answer);
    const result = await no.call("close_window", { window: "w3" });
    expect(result).toMatchObject({ isError: true, content: [{ text: SAID_NO }] });
    expect(no.requests).not.toContain("close");
  }
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
