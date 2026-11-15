/**
 * An agent that only connected is not in the bar (decisions.md D136 to D139):
 * a connection is quiet until it calls a tool and again a while after its
 * last call, unless it holds something; the sessions of one agent are one
 * row (the bar's one sign for them is agents-one-mark.test.tsx); and a
 * connection that never called is not in the activity log.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nowItems } from "../src/agents/ask/now.ts";
import { stateDir } from "../src/agents/consent.ts";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentInfo } from "../src/agents/index.ts";
import { groupConnections } from "../src/agents/lib/agent-groups.ts";
import { Session } from "../src/agents/lib/session/session.ts";
import { QUIET_AFTER_MS, quietAfter, SessionQuiet } from "../src/agents/lib/session/session-quiet.ts";
import type { SessionContext } from "../src/agents/lib/session/session-types.ts";
import { idleConnections, markState, mergeAgents } from "../src/agents/mark.ts";
import { SiteGrants } from "../src/agents/sites.ts";
import { idleWords, rowTitle } from "../src/agents-panel/lib/agents-rows.tsx";
import { fakeCompositor } from "./support/compositor.ts";
import { fakeClockEachTest, flush } from "./support/time.ts";

const claude = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: "claude",
  key: "/home/alexk/.local/bin/claude",
  status: "Idle",
  scopes: [],
  detail: "~/.local/bin/claude",
  claims: "claude-code",
  harness: "claude-code",
  since: id,
  quiet: false,
  acted: 1000 + id,
  ...extra,
});
const idle = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => claude(id, { status: "Connected", quiet: true, acted: undefined, ...extra });

describe("the wait (session-quiet.ts)", () => {
  test("quiet until its first call, in sight for five minutes after its last, then quiet again; what it holds keeps it", () => {
    let now = 0;
    const timers: Array<{ run: () => void; at: number }> = [];
    let published = 0;
    const quiet = new SessionQuiet(() => published++, {
      now: () => now,
      timers: { set: (run, ms) => timers.push({ run, at: now + ms }), clear: () => {} },
      afterMs: QUIET_AFTER_MS,
    });
    expect(quiet.quiet(false)).toBe(true);
    quiet.act();
    expect(quiet.quiet(false)).toBe(false);
    now = QUIET_AFTER_MS - 1;
    expect(quiet.quiet(false)).toBe(false);
    now = QUIET_AFTER_MS;
    expect(quiet.quiet(false)).toBe(true);
    // The lists are made again by themselves once the wait is over.
    timers.at(-1)?.run();
    expect(published).toBe(1);
    // Holding something (a recording, a sheet, a Desktop of its own) keeps it, however long ago it called.
    expect(quiet.quiet(true)).toBe(false);
    // Its next call brings it back.
    quiet.act();
    expect(quiet.quiet(false)).toBe(false);
  });

  test("five minutes, or the short wait a proof names", () => {
    expect(QUIET_AFTER_MS).toBe(300_000);
    expect(quietAfter({})).toBe(QUIET_AFTER_MS);
    expect(quietAfter({ DASHI_AGENTS_QUIET_MS: "20000" })).toBe(20_000);
    expect(quietAfter({ DASHI_AGENTS_QUIET_MS: "soon" })).toBe(QUIET_AFTER_MS);
  });
});

describe("a connection (session.ts)", () => {
  const clock = fakeClockEachTest();

  function connect(name: string, alone?: { on: boolean }) {
    let published = 0;
    const ctx = {
      compositor: fakeCompositor(async () => ({}), { windows: async () => [] }),
      ui: { dismiss: () => {}, stopped: () => {}, whenNoSheet: async () => {} },
      desktop: {},
      grants: { get: () => new Set(["see"]), set: () => {} },
      sites: new SiteGrants(null),
      lock: { isLocked: false },
      publish: () => published++,
      arrangement: () => null,
      ...(alone
        ? { alone: { status: () => ({ on: alone.on, secondsLeft: 0, scopes: [], sites: [] }), covers: () => false, holds: () => false, note: () => {} } }
        : {}),
      secrets: { sources: () => [], atspi: async () => null, handedOver: new Set<number>(), filled: new Map() },
    } as unknown as SessionContext;
    const session = new Session(1, { name, detail: name, key: name, remote: false }, { write: (data) => data.byteLength, terminate: () => {} }, ctx, () => {});
    const say = (message: unknown) => session.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
    say({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code" } } });
    say({ jsonrpc: "2.0", method: "notifications/initialized" });
    say({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    say({ jsonrpc: "2.0", id: 3, method: "ping" });
    say({ jsonrpc: "2.0", id: 4, method: "resources/list" });
    let next = 10;
    const call = async (tool: string) => {
      say({ jsonrpc: "2.0", id: next++, method: "tools/call", params: { name: tool, arguments: {} } });
      await flush();
    };
    return { session, call, published: () => published };
  }

  const logged = (agent: string): string[] => {
    const path = join(stateDir(), "activity.jsonl");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes(`"agent":"${agent}"`))
      .map((line) => `${(JSON.parse(line) as { tool: string | null }).tool}:${(JSON.parse(line) as { outcome: string }).outcome}`);
  };

  test("initialize, tools/list, ping and a method Dashi does not speak show nothing; a read does; five minutes later it is quiet again", async () => {
    const { session, call, published } = connect("quiet-one");
    expect(session.info()).toMatchObject({ quiet: true });
    expect(session.info().acted).toBeUndefined();
    // A read looks at the person's computer: it counts.
    await call("list_windows");
    expect(session.info()).toMatchObject({ quiet: false, acted: expect.any(Number) });
    await clock.advance(QUIET_AFTER_MS - 5_000);
    expect(session.info().quiet).toBe(false);
    const before = published();
    await clock.advance(10_000);
    expect(session.info().quiet).toBe(true);
    // The bar hears of it without anyone asking.
    expect(published()).toBeGreaterThan(before);
    await call("list_windows");
    expect(session.info().quiet).toBe(false);
  });

  test("Work alone keeps an agent that has called in sight for as long as it lasts, and never one that has not", async () => {
    const alone = { on: true };
    const acted = connect("alone-one", alone);
    const never = connect("alone-two", alone);
    await acted.call("list_windows");
    await clock.advance(QUIET_AFTER_MS * 3);
    expect(acted.session.info().quiet).toBe(false);
    expect(never.session.info().quiet).toBe(true);
    alone.on = false;
    expect(acted.session.info().quiet).toBe(true);
  });

  test("a connection that came and went without one call is not in the activity log; one that called is, with its end", async () => {
    connect("log-idle").session.stop("disconnected");
    connect("log-stopped").session.stop("stopped");
    expect(logged("log-idle")).toEqual([]);
    expect(logged("log-stopped")).toEqual([]);
    const { session, call } = connect("log-acted");
    await call("list_windows");
    session.stop("disconnected");
    expect(logged("log-acted")).toEqual(["list_windows:ok", "null:disconnected"]);
  });
});

describe("one row per agent (agent-groups.ts, mark.ts)", () => {
  test("sessions of one program are one entry with a count; the line is the one that waits, works, or called last", () => {
    const entries = mergeAgents(
      [claude(1), claude(2, { status: "Taking a screenshot", watching: "screen", watchingSince: 5 }), claude(3), idle(4), idle(5)],
      [],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: "agent:1", sessions: 3, doing: "Taking a screenshot", phase: "working", watching: "screen", watchingSince: 5 });
    expect(entries[0]?.agents?.map((agent) => agent.id)).toEqual([2, 3, 1]);
    expect(rowTitle(entries[0] as { name: string; sessions: number })).toBe("claude · 3 sessions");
    expect(rowTitle({ name: "claude", sessions: 1 })).toBe("claude");
    // At rest, the one that called last speaks.
    expect(groupConnections([claude(1), claude(2), claude(3, { acted: 1 })])[0]?.lead.id).toBe(2);
    // One whose sheet is up speaks before one at work.
    expect(mergeAgents([claude(1, { status: "Typing" }), claude(2, { waiting: true })], [])[0]).toMatchObject({ doing: "Waiting for you", phase: "waiting" });
  });

  test("another program, another name it claims, or a remote agent is another row", () => {
    const codex = claude(2, { name: "codex", key: "/usr/bin/codex", claims: "codex", harness: "codex" });
    const other = claude(3, { claims: "claude-desktop" });
    const remote = claude(4, { key: "ssh:claude-code", remote: true });
    expect(mergeAgents([claude(1), codex, other, remote, claude(5)], []).map((entry) => entry.sessions)).toEqual([1, 1, 1, 2]);
  });

  test("connected and idle is no entry: counted for the panel's foot, and a working run's own connection is neither", () => {
    const runs = new AgentRuns({ now: () => 0 });
    runs.start({ id: "r1", request: "Cut the demo video", harness: "claude-code", harnessName: "Claude Code", started: 1 });
    const connections = [idle(1), idle(2), idle(3), idle(9, { task: "r1" })];
    expect(mergeAgents(connections, []).length).toBe(0);
    expect(markState(mergeAgents(connections, []))).toEqual({ kind: "none" });
    expect(idleConnections(connections, runs.getSnapshot())).toBe(3);
    expect(idleWords(3, 0)).toBe("3 connected, idle");
    expect(idleWords(5, 2)).toBe("5 more connected, idle");
    // The launcher's Now leaves them out too.
    expect(nowItems({ turns: [], tasks: [], agents: [idle(1), claude(2, { status: "Typing" })] })).toEqual([
      { kind: "agent", id: 2, name: "claude", status: "Typing" },
    ]);
  });
});
