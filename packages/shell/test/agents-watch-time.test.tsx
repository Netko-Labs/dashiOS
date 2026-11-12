/**
 * How long an agent has been recording or seeing the screen: the session's
 * clock of its calls (agents/lib/watch-clock.ts), the time a row's chip says
 * (agents/mark.ts `watchTime`), and the chip ticking once a second while
 * the agents' panel shows it (agents-panel/lib/agents-rows.tsx).
 */

import { describe, expect, test } from "bun:test";
import { type NativeTransport, render } from "@mirinjs/metal";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import type { AgentInfo } from "../src/agents/index.ts";
import { WatchClock } from "../src/agents/lib/watch-clock.ts";
import { mergeAgents, watchTime } from "../src/agents/mark.ts";
import { AccessChip } from "../src/agents-panel/lib/agents-rows.tsx";
import { fakeClock, flush } from "./support/time.ts";

const SETTLE = 3_000;

describe("WatchClock", () => {
  test("nothing watched: null", () => {
    expect(new WatchClock(SETTLE).now(0)).toBeNull();
  });

  test("a recording counts from its start", () => {
    const clock = new WatchClock(SETTLE);
    clock.start("recording", 1_000);
    expect(clock.now(135_000)).toEqual({ kind: "recording", since: 1_000 });
  });

  test("screenshots close together are one stretch of seeing the screen", () => {
    const clock = new WatchClock(SETTLE);
    clock.start("screen", 0);
    clock.end("screen", 400);
    // Still shown for the settle after it, with its time going on.
    expect(clock.now(2_000)).toEqual({ kind: "screen", since: 0 });
    clock.start("screen", 2_500);
    clock.end("screen", 2_900);
    expect(clock.now(3_000)).toEqual({ kind: "screen", since: 0 });
  });

  test("after a pause longer than the settle, the time starts again", () => {
    const clock = new WatchClock(SETTLE);
    clock.start("screen", 0);
    clock.end("screen", 400);
    expect(clock.now(3_400)).toBeNull();
    clock.start("screen", 10_000);
    expect(clock.now(10_500)).toEqual({ kind: "screen", since: 10_000 });
  });

  test("a recording outranks seeing the screen, with its own time", () => {
    const clock = new WatchClock(SETTLE);
    clock.start("screen", 0);
    clock.start("recording", 5_000);
    expect(clock.now(6_000)).toEqual({ kind: "recording", since: 5_000 });
    clock.end("recording", 7_000);
    expect(clock.now(8_000)).toEqual({ kind: "screen", since: 0 });
  });

  test("two calls of a kind at once: it ends with the last", () => {
    const clock = new WatchClock(SETTLE);
    clock.start("screen", 0);
    clock.start("screen", 100);
    clock.end("screen", 200);
    expect(clock.now(10_000)).toEqual({ kind: "screen", since: 0 });
    clock.end("screen", 10_000);
    expect(clock.now(13_001)).toBeNull();
  });
});

describe("watchTime", () => {
  test("recording or seeing the screen: how long, as a timer says it", () => {
    expect(watchTime({ watching: "recording", watchingSince: 0 }, 134_000)).toBe("2:14");
    expect(watchTime({ watching: "screen", watchingSince: 1_000 }, 8_400)).toBe("0:07");
    expect(watchTime({ watching: "recording", watchingSince: 0 }, 3_723_000)).toBe("1:02:03");
  });

  test("its pointer's clicks, nothing watched, or no start known: no time", () => {
    expect(watchTime({ watching: "pointer", watchingSince: 0 }, 5_000)).toBeNull();
    expect(watchTime({ watching: null, watchingSince: null }, 5_000)).toBeNull();
    expect(watchTime({ watching: "recording", watchingSince: null }, 5_000)).toBeNull();
  });
});

const connection = (id: number, extra: Partial<AgentInfo> = {}): AgentInfo => ({
  id,
  name: "claude",
  status: "Connected",
  scopes: [],
  since: id,
  ...extra,
});

describe("an entry's start", () => {
  test("a connection's own", () => {
    const [entry] = mergeAgents([connection(1, { watching: "recording", watchingSince: 500 })], []);
    expect(entry?.watchingSince).toBe(500);
  });

  test("a run's: the earliest of its connections doing what it shows", () => {
    const store = new AgentRuns({ now: () => 0 });
    store.start({ id: "r1", request: "Cut the demo video", harness: "claude-code", harnessName: "Claude Code", started: 0 });
    const [entry] = mergeAgents(
      [
        connection(1, { task: "r1", watching: "screen", watchingSince: 100 }),
        connection(2, { task: "r1", watching: "recording", watchingSince: 900 }),
        connection(3, { task: "r1", watching: "recording", watchingSince: 700 }),
      ],
      store.getSnapshot(),
    );
    expect(entry).toMatchObject({ kind: "run", watching: "recording", watchingSince: 700 });
  });

  test("not watching: none, whatever the connection says", () => {
    const [entry] = mergeAgents([connection(1, { watching: null, watchingSince: 500 })], []);
    expect(entry?.watchingSince).toBeNull();
  });
});

describe("the chip", () => {
  test("says the time and goes on once a second while shown", async () => {
    const trees: string[] = [];
    const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const clock = fakeClock();
    const since = Date.now() - 134_400;
    const root = render(<AccessChip entry={{ watching: "recording", watchingSince: since, phase: "working", kind: "connection" }} />, transport);
    await flush();
    expect(trees.at(-1)).toContain("Recording the screen · 2:14");
    await clock.advance(1_100);
    expect(trees.at(-1)).toContain("Recording the screen · 2:15");
    root.unmount();
    clock.restore();
  });

  test("its pointer: words only, nothing ticking", async () => {
    const trees: string[] = [];
    const transport: NativeTransport = { send: (tree) => trees.push(tree), onEvent() {}, onClose() {}, simulate() {}, close() {} };
    const clock = fakeClock();
    const root = render(<AccessChip entry={{ watching: "pointer", watchingSince: 0, phase: "working", kind: "connection" }} />, transport);
    await flush();
    const sent = trees.length;
    expect(trees.at(-1)).toContain("Using its pointer");
    expect(trees.at(-1)).not.toContain("·");
    await clock.advance(1_100);
    expect(trees.length).toBe(sent);
    root.unmount();
    clock.restore();
  });
});
