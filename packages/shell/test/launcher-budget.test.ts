import { describe, expect, test } from "bun:test";
import type { Entry } from "../src/entries.ts";
import { BUDGET, type SlowSnapshot, type SlowSource, SlowSources, type Timers, timed } from "../src/launcher/budget.ts";
import { buildSections } from "../src/launcher/rows.ts";
import { isTiming, timingLine } from "../src/launcher/timing.ts";

/** Timers the test moves by hand. */
function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    set: (callback, ms) => {
      next += 1;
      due.set(next, { at: now + ms, callback });
      return next;
    },
    clear: (handle) => {
      due.delete(handle as number);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...due].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        due.delete(id);
        timer.callback();
      }
    },
  };
}

/** A source whose answers the test hands out. */
function source(id: string): SlowSource<string> & { answer(rows: string[]): void; fail(): void; asked: string[] } {
  let pending: { resolve: (rows: string[]) => void; reject: (error: Error) => void } | null = null;
  const asked: string[] = [];
  return {
    id,
    label: id[0]?.toUpperCase() + id.slice(1),
    asked,
    ask(query) {
      asked.push(query);
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
    answer(rows) {
      pending?.resolve(rows);
    },
    fail() {
      pending?.reject(new Error("no"));
    },
  };
}

const states = (snapshot: SlowSnapshot<string> | undefined) => snapshot?.sources.map((each) => [each.id, each.state.kind]);

describe("slow sources", () => {
  test("an answer inside the budget is on time; one past it is marked slow and appended after", async () => {
    const timers = fakeTimers();
    const weather = source("weather");
    const notes = source("notes");
    const seen: SlowSnapshot<string>[] = [];
    const sources = new SlowSources([weather, notes], (snapshot) => seen.push(snapshot), timers);
    sources.start("lis");
    expect(states(seen.at(-1))).toEqual([
      ["weather", "waiting"],
      ["notes", "waiting"],
    ]);
    timers.advance(30);
    notes.answer(["Lisbon trip"]);
    await Bun.sleep(0);
    timers.advance(BUDGET.slowMs);
    expect(states(seen.at(-1))).toEqual([
      ["weather", "slow"],
      ["notes", "answered"],
    ]);
    weather.answer(["Lisbon 21°"]);
    await Bun.sleep(0);
    // On-time answers first (in the sources' order), then late ones: nothing above moves.
    const last = seen.at(-1);
    expect(last?.sources.map((each) => each.id)).toEqual(["notes", "weather"]);
    expect(last?.sources[1]?.state).toEqual({ kind: "answered", rows: ["Lisbon 21°"], isLate: true });
    expect(last?.sources[0]?.state).toEqual({ kind: "answered", rows: ["Lisbon trip"], isLate: false });
  });

  test("an answer for an older query is dropped", async () => {
    const timers = fakeTimers();
    const weather = source("weather");
    const seen: SlowSnapshot<string>[] = [];
    const sources = new SlowSources([weather], (snapshot) => seen.push(snapshot), timers);
    sources.start("li");
    sources.start("lis");
    const count = seen.length;
    weather.answer(["for lis"]);
    await Bun.sleep(0);
    expect(seen.length).toBe(count + 1);
    expect(seen.at(-1)?.query).toBe("lis");
    sources.stop();
    weather.answer(["after close"]);
    await Bun.sleep(0);
    expect(seen.length).toBe(count + 1);
  });

  test("late three times, a source is dropped for the session; a failure isn't a miss", async () => {
    const timers = fakeTimers();
    const weather = source("weather");
    const sources = new SlowSources([weather], () => {}, timers);
    for (let miss = 1; miss <= BUDGET.misses; miss++) {
      expect(sources.isDropped("weather")).toBe(false);
      sources.start(`q${miss}`);
      timers.advance(BUDGET.slowMs + 1);
    }
    expect(sources.isDropped("weather")).toBe(true);
    const asked = weather.asked.length;
    sources.start("again");
    expect(weather.asked.length).toBe(asked);
    expect(sources.snapshot().sources).toEqual([]);

    const flaky = source("flaky");
    const others = new SlowSources([flaky], () => {}, timers);
    for (let round = 0; round < 5; round++) {
      others.start(`r${round}`);
      flaky.fail();
      await Bun.sleep(0);
      timers.advance(BUDGET.slowMs + 1);
    }
    expect(others.isDropped("flaky")).toBe(false);
    expect(others.snapshot().sources[0]?.state.kind).toBe("failed");
  });
});

describe("instant sources", () => {
  test("timed says how long the work took and whether it went over", () => {
    let clock = 0;
    const result = timed(
      () => {
        clock += 3;
        return "rows";
      },
      BUDGET.instantMs,
      () => clock,
    );
    expect(result).toEqual({ value: "rows", ms: 3, isOver: true });
    expect(
      timed(
        () => 1,
        BUDGET.instantMs,
        () => clock,
      ).isOver,
    ).toBe(false);
  });
});

describe("the typing budget, measured", () => {
  const words = ["terminal", "files", "notes", "settings", "display", "network", "firefox", "editor", "calendar", "music", "photo", "mail"];
  const entries: Entry[] = Array.from({ length: 5000 }, (_, i) => ({
    id: `app.${i}`,
    name: `${words[i % words.length]} ${words[(i * 7) % words.length]} ${i}`,
    icon: "/i.svg",
    keywords: [words[(i * 5) % words.length] as string, `word${i}`],
  }));
  const icons = { calculator: "/c.svg", files: "/f.svg", software: "/s.svg" };

  test("ranking 5,000 entries keeps inside the instant budget (median, with room for a slow machine)", () => {
    // Not "Nothing called …": its Did you mean measures a typo against every entry (launcher/suggest.ts),
    // about 6 ms at 5,000; the fuzzy ranking that replaces it has to come in under the budget too.
    for (const query of ["t", "ter", "terminal", "set", "5 km in mi"]) {
      const runs = Array.from(
        { length: 15 },
        () => timed(() => buildSections({ query, entries, recent: [], files: { kind: "none" }, icons }), BUDGET.instantMs).ms,
      );
      const median = runs.sort((a, b) => a - b)[7] as number;
      expect(median).toBeLessThan(BUDGET.instantMs * 2);
    }
  });

  test("the timing log is off unless asked for, and says the budget", () => {
    expect(isTiming({})).toBe(false);
    expect(isTiming({ DASHI_LAUNCHER_TIMING: "1" })).toBe(true);
    expect(timingLine("open → first frame", 31.24, 50, "resident host")).toBe(
      "dashi-shell: launcher: open → first frame 31.2 ms (budget 50 ms, resident host)",
    );
    expect(timingLine("files", 95, 80)).toBe("dashi-shell: launcher: files 95.0 ms (budget 80 ms, over)");
  });
});
