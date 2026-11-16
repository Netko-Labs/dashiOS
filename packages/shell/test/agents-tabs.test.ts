import { describe, expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { tabsCall } from "../src/agents/desktop/tabs.ts";
import { parseCall } from "../src/agents/index.ts";
import { needsSpokenYes } from "../src/agents/lib/session/session-assistant.ts";

const TABS = [
  { id: 1, windowId: 10, active: true, title: "Inbox", url: "https://mail.example/inbox", loading: false },
  { id: 2, windowId: 10, active: false, title: "Lichess", url: "https://lichess.org/", loading: false },
  { id: 3, windowId: 11, active: true, title: "Docs", url: "https://docs.example/", loading: true },
];

function harness(options: { see?: boolean; opened?: number[]; moved?: boolean } = {}) {
  const asked: string[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const link = {
    hello: { browserPid: 1 },
    ask: async (method: string, params: Record<string, unknown>) => {
      sent.push([method, params]);
      if (method === "tabs") return { tabs: TABS, focusedWindow: 10 };
      if (method === "close") return { closed: true };
      return { load: { loaded: true }, moved: options.moved ?? true, url: "https://lichess.org/game", title: "Game" };
    },
  };
  const browser = {
    link: () => link,
    whenConnected: async () => link,
    allowSite: async () => true,
    mayUse: () => false,
    tab: null as number | null,
    opened: new Set(options.opened ?? []),
  };
  const ctx = {
    browser,
    status: () => {},
    mayName: () => options.see ?? true,
    confirm: async (question: { summary: string }) => {
      asked.push(question.summary);
      return false;
    },
  } as unknown as RunContext;
  return { ctx, asked, sent, browser };
}

const call = (name: string, args: Record<string, unknown> = {}) => {
  const parsed = parseCall({ name, arguments: args });
  if ("arguments" in parsed || "unknown" in parsed) throw new Error(JSON.stringify(parsed));
  return parsed as Parameters<typeof tabsCall>[0];
};

describe("the browser's tabs", () => {
  test("every tab of every window, with its title and address, which is in front, and which are the agent's", async () => {
    const h = harness({ opened: [2] });
    const result = await tabsCall(call("list_tabs"), h.ctx);
    expect(result.structuredContent?.tabs).toEqual([
      { tab: "t1", url: "https://mail.example/inbox", title: "Inbox", front: true, window: 10, inFrontWindow: true },
      { tab: "t2", url: "https://lichess.org/", title: "Lichess", front: false, window: 10, yours: true },
      { tab: "t3", url: "https://docs.example/", title: "Docs", front: true, window: 11, loading: true },
    ]);
    // Without "see windows" and with no site allowed: the site only.
    const blind = await tabsCall(call("list_tabs"), harness({ see: false }).ctx);
    expect((blind.structuredContent?.tabs as Array<Record<string, unknown>>)[0]).toMatchObject({ tab: "t1", url: "mail.example" });
  });

  test("closing a tab asks nobody (not critical), and the tab is no longer the agent's", async () => {
    const theirs = harness({ opened: [] });
    theirs.browser.tab = 1;
    expect((await tabsCall(call("close_tab"), theirs.ctx)).structuredContent).toEqual({ closed: "t1" });
    expect(theirs.asked).toEqual([]);
    expect(theirs.sent.at(-1)).toEqual(["close", { tab: 1 }]);
    expect(theirs.browser.tab).toBeNull();
    expect(needsSpokenYes("close_tab")).toBe(false);
  });

  test("back, forward and reload say where the tab is, and that there was nowhere to go", async () => {
    const h = harness({ see: true });
    const back = await tabsCall(call("go_back", { tab: "t2" }), h.ctx);
    expect(back.content[0]).toMatchObject({ text: expect.stringContaining("It loaded") });
    expect(h.sent.at(-1)).toEqual(["back", { tab: 2 }]);
    const nowhere = await tabsCall(call("go_forward", { tab: "t2" }), harness({ moved: false }).ctx);
    expect(nowhere.content[0]).toMatchObject({ text: expect.stringContaining("no page to go forward to") });
    expect(call("reload_tab")).toEqual({ name: "reload_tab", tab: null });
  });
});
