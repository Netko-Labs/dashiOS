import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord, type RunRecord } from "../src/agents/handoff/lib/records.ts";
import type { FoundRun, TurnRead } from "../src/agents/handoff/lib/runner.ts";
import { helium, line, service } from "./support/handoff-service.ts";

const fixtureLines = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", "handoff", name), "utf8")
    .split("\n")
    .filter(Boolean);

describe("a shell that restarts picks its runs up again", () => {
  const moment = 1_800_000_000_000;
  const record = (extra: Partial<RunRecord> = {}): RunRecord => ({
    v: 1,
    id: "abcd1234",
    request: "Book a spinning class",
    harness: "codex",
    started: moment - 5 * 60_000,
    turn: 1,
    unit: "dashi-task-abcd1234-1.service",
    log: "/run/user/1000/dashi-agents/abcd1234/turn-1.jsonl",
    messages: [],
    window: 3,
    sites: ["bodytech.com.co"],
    undos: [],
    stopped: null,
    told: null,
    ...extra,
  });
  const found = (each: RunRecord | null, extra: Partial<FoundRun> = {}): FoundRun => ({
    id: each?.id ?? "abcd1234",
    record: each,
    turn: each?.turn ?? 1,
    prompt: "",
    promptAt: 0,
    ...extra,
  });
  const codexTurn = (changed: number): TurnRead => ({ lines: fixtureLines("codex.jsonl"), exit: { code: 0 }, changed });

  test("each run keeps a record beside its streams: what the card needs, never the context's words", async () => {
    const { handoff, saved, watchers } = service();
    await handoff.start({ harness: "claude-code", request: "Book a class", context: { ...helium, selection: "my secret notes" } });
    handoff.policy("run1")?.sites.add("bodytech.com.co");
    watchers.get("run1:1")?.line(line({ type: "system", subtype: "init", session_id: "s-1" }));
    const last = saved.at(-1);
    expect(last).toMatchObject({
      v: 1,
      id: "run1",
      request: "Book a class",
      harness: "claude-code",
      turn: 1,
      unit: "dashi-task-run1-1.service",
      log: "/run/user/1000/dashi-agents/run1/turn-1.jsonl",
      window: 3,
      sites: ["bodytech.com.co"],
      stopped: null,
    });
    expect(JSON.stringify(saved)).not.toContain("my secret notes");
    expect(JSON.stringify(saved)).not.toContain("bodytech.com.co/clases");
    // It parses back as it was written.
    expect(parseRecord(JSON.stringify(last))).toEqual(last as RunRecord);
    handoff.stop("run1");
    expect(saved.at(-1)?.stopped).toBe(1);
    handoff.close();
  });

  test("a run still working: its card from its streams and record, new steps as they come, Stop stops its unit", () => {
    const told: string[] = [];
    const disk = {
      runs: [found(record({ turn: 2, messages: [{ text: "the 7:30 one", at: moment - 60_000 }], told: 1 }), { turn: 2 })],
      running: new Map([["abcd1234", 2]]),
      turns: new Map([["abcd1234:1", codexTurn(moment - 2 * 60_000)]]),
    };
    const { handoff, watchers, stopped, saved } = service(disk, { now: () => moment, ended: (run) => told.push(`${run.id}:${run.turn}`) });
    const run = handoff.runs.get("abcd1234");
    expect(run).toMatchObject({
      request: "Book a spinning class",
      harness: "codex",
      harnessName: "Codex",
      started: moment - 5 * 60_000,
      turn: 2,
      phase: "starting",
    });
    expect(run?.steps.map((step) => step.words)).toEqual(["Opened bodytech.com.co", "Couldn't: signing in to bodytech.com.co"]);
    expect(run?.messages).toEqual([{ text: "the 7:30 one", at: moment - 60_000 }]);
    expect(run?.session).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
    // Its connection's policy comes back with the sites allowed for the task.
    expect(handoff.policy("abcd1234")).toEqual({
      granted: ["web", "signin", "pay"],
      refused: ["see", "screen", "act", "files", "clipboard"],
      window: 3,
      name: "Codex",
      sites: new Set(["bodytech.com.co"]),
    });
    // Its record isn't written over with what the replay had halfway.
    expect(saved.filter((each) => each.turn < 2)).toEqual([]);
    // Its turn goes on being read.
    const watcher = watchers.get("abcd1234:2");
    expect(watcher).toBeDefined();
    watcher?.line(
      line({ type: "item.started", item: { id: "item_9", type: "mcp_tool_call", server: "dashi", tool: "read_page", arguments: {}, status: "in_progress" } }),
    );
    expect(handoff.runs.get("abcd1234")?.phase).toBe("working");
    expect(handoff.runs.get("abcd1234")?.steps).toHaveLength(3);
    // No notification for the turn the person heard of before.
    expect(told).toEqual([]);
    handoff.stop("abcd1234");
    expect(stopped).toEqual(["abcd1234:2"]);
    watcher?.exit(null);
    expect(handoff.runs.get("abcd1234")?.phase).toBe("stopped");
    expect(saved.at(-1)).toMatchObject({ id: "abcd1234", turn: 2, stopped: 2 });
    handoff.close();
  });

  test("a run ended in the last hour comes back as it ended, then; told of once if it ended while the shell was away", () => {
    const told: string[] = [];
    const ended = moment - 10 * 60_000;
    const disk = {
      runs: [found(record()), found(record({ id: "efgh5678", told: 1 }))],
      running: new Map<string, number>(),
      turns: new Map([
        ["abcd1234:1", codexTurn(ended)],
        ["efgh5678:1", codexTurn(ended)],
      ]),
    };
    const { handoff } = service(disk, { now: () => moment, ended: (run) => told.push(run.id) });
    expect(handoff.runs.get("abcd1234")).toMatchObject({ phase: "done", ended, summary: "Couldn't sign in to Bodytech: you said no.\nNothing was booked." });
    expect(handoff.runs.get("efgh5678")?.phase).toBe("done");
    expect(told).toEqual(["abcd1234"]);
    handoff.close();
  });

  test("a run the person stopped before the shell restarted reads 'stopped'", () => {
    const disk = {
      runs: [found(record({ stopped: 1, told: 1 }))],
      running: new Map<string, number>(),
      turns: new Map([["abcd1234:1", { lines: fixtureLines("codex.jsonl").slice(0, 5), exit: { code: null }, changed: moment - 60_000 }]]),
    };
    const { handoff } = service(disk, { now: () => moment });
    expect(handoff.runs.get("abcd1234")?.phase).toBe("stopped");
    handoff.close();
  });

  test("one ended over an hour ago doesn't come back, and its files go", () => {
    const disk = { runs: [found(record())], running: new Map<string, number>(), turns: new Map([["abcd1234:1", codexTurn(moment - 2 * 60 * 60_000)]]) };
    const { handoff, forgotten } = service(disk, { now: () => moment });
    expect(handoff.runs.get("abcd1234")).toBeUndefined();
    expect(forgotten).toEqual(["abcd1234"]);
    handoff.close();
  });

  test("a running unit without a record (an older shell started it): its card from its prompt and stream", () => {
    const disk = {
      runs: [found(null, { prompt: "Book a spinning class\n\nThe person was in Helium.", promptAt: moment - 3 * 60_000 })],
      running: new Map([["abcd1234", 1]]),
      turns: new Map([["abcd1234:1", { lines: fixtureLines("codex.jsonl").slice(0, 5), exit: undefined, changed: moment }]]),
    };
    const { handoff, watchers } = service(disk, { now: () => moment });
    expect(handoff.runs.get("abcd1234")).toMatchObject({ request: "Book a spinning class", harness: "codex", started: moment - 3 * 60_000 });
    expect(watchers.has("abcd1234:1")).toBe(true);
    expect(handoff.policy("abcd1234")?.window).toBeNull();
    handoff.close();
  });
});
