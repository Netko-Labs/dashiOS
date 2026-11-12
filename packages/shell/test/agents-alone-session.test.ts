/**
 * Work alone on an agent's connection (agents/lib/session/): what the person
 * picked runs with no sheet, everything else asks as it always does, a tool
 * that asks every time still asks, nothing is kept when it ends, and an
 * agent can read whether it is on but never turn it on.
 */

import { describe, expect, test } from "bun:test";
import { WorkAlone } from "../src/agents/alone/work-alone.ts";
import type { Scope } from "../src/agents/consent.ts";
import { Session } from "../src/agents/lib/session/session.ts";
import type { SessionContext, SessionTask } from "../src/agents/lib/session/session-types.ts";
import type { Answer, Ask, Confirm } from "../src/agents/presence.ts";
import { DENY } from "../src/agents/sheet-queue.ts";
import { SiteGrants } from "../src/agents/sites.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { fakeClockEachTest, flush } from "./support/time.ts";

const clock = fakeClockEachTest();

const WINDOW = {
  id: 3,
  appId: "helium",
  title: "t",
  pid: 10,
  focused: true,
  state: "normal" as const,
  frame: { x: 0, y: 0, width: 9, height: 9 },
  titleBar: 0,
};

/** A connection that was allowed `granted` for good, with Work alone beside it; `asks` and `confirms` are the sheets it put up. */
function harness(alone: WorkAlone, granted: Scope[] = [], task: SessionTask | null = null) {
  const sent: Array<{ id?: number; result?: { isError?: boolean; content: Array<{ text: string }>; structuredContent?: Record<string, unknown> } }> = [];
  const asks: Ask[] = [];
  const confirms: Confirm[] = [];
  const kept: Scope[][] = [];
  const ui = {
    ask: async (ask: Ask): Promise<Answer> => {
      asks.push(ask);
      return DENY;
    },
    confirm: async (confirm: Confirm) => {
      confirms.push(confirm);
      return false;
    },
    allowSite: async () => "deny" as const,
    signIn: async () => ({ allow: "deny" as const, login: null }),
    turn: async () => false,
    dismiss: () => {},
    stopped: () => {},
    whenNoSheet: async () => {},
  };
  const ctx = {
    compositor: fakeCompositor(async () => ({}), { windows: async () => [WINDOW] }),
    ui,
    desktop: { forceQuit: { apps: () => [{ pid: 10, appId: "helium", name: "Helium", windows: [WINDOW] }] } },
    grants: { get: () => new Set(granted), set: (_key: string, scopes: Set<Scope>) => kept.push([...scopes]) },
    sites: new SiteGrants(null),
    lock: { isLocked: false },
    publish: () => {},
    arrangement: () => null,
    alone,
    secrets: {
      sources: () => [],
      atspi: async () => null,
      handedOver: new Set<number>(),
      filled: new Map(),
      vault: { cards: async () => [], pay: async () => Promise.reject(new Error("no")) },
    },
  } as unknown as SessionContext;
  const session = new Session(
    1,
    { name: "claude", detail: "claude", key: "claude", remote: false },
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
    task,
  );
  const say = (message: unknown) => session.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  say({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test" } } });
  let next = 2;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const id = next++;
    say({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    await flush();
    return sent.find((message) => message.id === id)?.result ?? null;
  };
  return { session, call, asks, confirms, kept };
}

const person = () => new WorkAlone({ personPressed: async () => true });

describe("an agent that was never allowed anything", () => {
  test("uses what the person picked with no sheet, and is asked about the rest", async () => {
    const alone = person();
    await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
    const h = harness(alone);
    const windows = await h.call("list_windows");
    expect(windows?.isError).toBeUndefined();
    expect(h.asks).toHaveLength(0);
    // Outside the list: the sheet, as always (here answered Don't Allow).
    const notifications = await h.call("list_notifications");
    expect(h.asks).toHaveLength(1);
    expect(h.asks[0]?.scopes.filter((scope) => scope.needed).map((scope) => scope.id)).toEqual(["notifications"]);
    expect(notifications?.isError).toBe(true);
    // Nothing was kept for it, and its own grants did not grow.
    expect(h.kept).toEqual([]);
    expect(h.session.info().scopes).toEqual([]);
  });

  test("is asked again once it ends: the time, or the person's stop", async () => {
    const alone = person();
    await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
    const h = harness(alone);
    await h.call("list_windows");
    expect(h.asks).toHaveLength(0);
    await clock.advance(60_000);
    await h.call("list_windows");
    expect(h.asks).toHaveLength(1);
  });

  test("a tool that asks every time still asks, on its own sheet, and its kind's sheet is not skipped for it", async () => {
    const alone = person();
    await alone.start({ scopes: ["act", "see"], sites: [], minutes: 1 });
    // Never allowed "act": Work alone covers the kind, but not force quit, so the kind's sheet asks.
    const stranger = harness(alone);
    await stranger.call("force_quit_app", { window: "w3" });
    expect(stranger.asks).toHaveLength(1);
    expect(stranger.confirms).toHaveLength(0);
    // Allowed "act" for good: the every-time sheet, exactly as without Work alone.
    const trusted = harness(alone, ["act", "see"]);
    const result = await trusted.call("force_quit_app", { window: "w3" });
    expect(trusted.asks).toHaveLength(0);
    expect(trusted.confirms).toHaveLength(1);
    expect(trusted.confirms[0]?.action).toBe("Force Quit");
    expect(result?.isError).toBe(true);
  });

  test("paying, signing in and the clipboard history ask whatever was picked", async () => {
    const alone = person();
    await alone.start({ scopes: ["see", "pay", "signin", "clipboard"], sites: [], minutes: 1 });
    const h = harness(alone);
    await h.call("list_logins");
    await h.call("read_clipboard_history");
    await h.call("pay", { window: "w3", site: "shop.example", amount: "12.00" });
    expect(h.asks.map((ask) => ask.scopes.filter((scope) => scope.needed).map((scope) => scope.id))).toEqual([["signin"], ["clipboard"], ["pay"]]);
  });

  test("a launcher run keeps what its card refused", async () => {
    const alone = person();
    await alone.start({ scopes: ["see", "files"], sites: [], minutes: 1 });
    const task: SessionTask = { id: "r1", policy: { granted: ["web"], refused: ["see", "files"], window: null, name: "Codex" } };
    const h = harness(alone, [], task);
    const result = await h.call("list_windows");
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("isn't allowed for this task");
  });
});

describe("what an agent can do about it", () => {
  test("reads whether it is on and how long is left, with no sheet and no permission", async () => {
    const alone = person();
    const h = harness(alone);
    expect((await h.call("get_work_alone"))?.structuredContent).toEqual({ on: false, secondsLeft: 0, scopes: [], sites: [] });
    await alone.start({ scopes: ["see", "web"], sites: ["example.com"], minutes: 2 });
    await clock.advance(30_000);
    expect((await h.call("get_work_alone"))?.structuredContent).toEqual({ on: true, secondsLeft: 90, scopes: ["see", "web"], sites: ["example.com"] });
    expect(h.asks).toHaveLength(0);
  });

  test("can't turn it on, lengthen or widen it: the tool takes no argument, and no other tool names it", async () => {
    const alone = person();
    const h = harness(alone);
    const result = await h.call("get_work_alone", { on: true, minutes: 480, scopes: ["act"] });
    expect(result?.isError).toBe(true);
    expect(alone.getSnapshot()).toEqual({ on: false });
    await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
    await h.call("get_work_alone", { minutes: 480 });
    expect(alone.status()).toMatchObject({ secondsLeft: 60, scopes: ["see"] });
  });

  test("its calls are in the record, with whether they asked", async () => {
    const alone = person();
    await alone.start({ scopes: ["see"], sites: [], minutes: 1 });
    await harness(alone).call("list_windows");
    await harness(alone, ["see"]).call("list_windows");
    const record = alone.stop();
    expect(record?.calls.map((call) => [call.agent, call.tool, call.outcome, call.free])).toEqual([
      ["claude", "list_windows", "ok", true],
      ["claude", "list_windows", "ok", false],
    ]);
  });
});
