/**
 * The jobs in the menu bar (menubar/lib/bar-jobs.ts, menubar/jobs.ts): which
 * tasks and agents are capsules, who speaks, what gives way when the room is
 * short, and what the mark counts.
 */

import { describe, expect, test } from "bun:test";
import type { TaskView } from "../src/agents/index.ts";
import { BarJobs } from "../src/menubar/index.ts";
import {
  type BarJob,
  capsuleWidth,
  FIN_SPEAKS_MS,
  firstWords,
  layoutJobs,
  MORE_JOBS_WIDTH,
  needCount,
  speaker,
  stampJobs,
  taskJobs,
} from "../src/menubar/lib/bar-jobs.ts";
import type { PillAsk } from "../src/shared/pill/index.ts";

const task = (id: string, phase: TaskView["phase"], request = "book me a yoga class on thursday evening", extra: Partial<TaskView> = {}): TaskView => ({
  id,
  answerer: { id: "claude", name: "Claude", where: "" },
  request,
  phase,
  steps: [],
  said: "",
  failure: null,
  ...extra,
});

const job = (key: string, state: BarJob["state"] = "run", extra: Partial<BarJob> = {}): BarJob => ({
  key,
  kind: "task",
  id: key,
  who: null,
  title: "Yoga class",
  step: "Choosing a time",
  state,
  ...extra,
});

describe("tasks as jobs", () => {
  test("the name is the first words of what was typed, whole words, capitalised", () => {
    expect(firstWords("book me a yoga class on thursday evening", 22)).toBe("book me a yoga class");
    const [only] = taskJobs([task("a", "asking")], [], new Set());
    expect(only).toMatchObject({ key: "task:a", title: "Book me a yoga class", step: "Thinking", state: "run", who: null });
  });

  test("the oldest first; a stopped task, a failed one that left Now and a done one already looked at are gone", () => {
    const tasks = [task("new", "running"), task("seen", "done"), task("fresh", "done"), task("left", "failed", "x", { leftNow: true }), task("old", "stopped")];
    expect(taskJobs(tasks, [], new Set(["seen"])).map((each) => [each.id, each.state])).toEqual([
      ["fresh", "fin"],
      ["new", "run"],
    ]);
  });

  test("a plan that waits for a yes needs you, and carries the card's ask when the capsule piece has one", () => {
    const ask: PillAsk = { kind: "permission", id: "ask-1", task: "a", request: "", steps: [], spoken: false, since: 0 };
    expect(taskJobs([task("a", "planned")], [], new Set())[0]).toMatchObject({ state: "need", step: "needs you" });
    expect(taskJobs([task("a", "planned")], [ask], new Set())[0]?.ask).toBe("ask-1");
    expect(taskJobs([task("a", "planned")], [], new Set())[0]?.ask).toBeUndefined();
  });

  test("a harness answers as itself", () => {
    expect(taskJobs([task("a", "asking", "x", { answerer: { id: "claude-code", name: "Claude Code", where: "" } })], [], new Set())[0]?.who).toBe(
      "claude-code",
    );
  });
});

describe("who speaks", () => {
  test("the one whose step changed last", () => {
    const first = stampJobs(new Map(), [job("a"), job("b")], 100);
    const jobs = [job("a", "run", { step: "Opening estudioluz.es" }), job("b")];
    const second = stampJobs(first, jobs, 200);
    expect(speaker(jobs, second, 200)).toBe("a");
    // Seen again with nothing new, the stamps stand.
    expect(stampJobs(second, jobs, 300).get("a")?.at).toBe(200);
  });

  test("a job that needs you speaks before any other, the oldest of them", () => {
    const jobs = [job("a"), job("b", "need"), job("c", "need")];
    expect(speaker(jobs, stampJobs(new Map(), jobs, 0), 0)).toBe("b");
  });

  test("a finished job says so for 8 s, then is a disc; an idle agent never speaks", () => {
    const jobs = [job("a", "fin"), job("b", "idle")];
    const stamps = stampJobs(new Map(), jobs, 1000);
    expect(speaker(jobs, stamps, 1000 + FIN_SPEAKS_MS - 1)).toBe("a");
    expect(speaker(jobs, stamps, 1000 + FIN_SPEAKS_MS)).toBeNull();
  });
});

describe("the row in the room it has", () => {
  const jobs = [job("x", "run", { who: "codex" }), job("c", "run", { who: "claude-code" }), job("d")];

  test("with room: discs, then the speaking capsule whole, against the mark", () => {
    const row = layoutJobs(jobs, "d", 400);
    expect(row.capsules.map(({ job: each, form }) => [each.key, form])).toEqual([
      ["x", "disc"],
      ["c", "disc"],
      ["d", "full"],
    ]);
    expect(row.more).toBe(0);
  });

  test("beside seven menus the name gives way first, the step stays", () => {
    const whole = capsuleWidth(job("d"), "full");
    const row = layoutJobs(jobs, "d", whole + 20);
    expect(row.capsules.at(-1)?.form).toBe("step");
    expect(row.more).toBe(0);
  });

  test("with no room the discs become a count; the one that needs you is never dropped and keeps its words", () => {
    const five = [job("a"), job("b"), job("c"), job("d"), job("n", "need", { step: "needs you" })];
    const room = MORE_JOBS_WIDTH + 4 + 20 + 4 + capsuleWidth(job("n", "need", { step: "needs you" }), "step");
    const row = layoutJobs(five, "n", room);
    expect(row.more).toBe(3);
    expect(row.capsules.map(({ job: each, form }) => [each.key, form])).toEqual([
      ["d", "disc"],
      ["n", "step"],
    ]);
    // A quiet speaker with no room for its step beside a count is a disc as well.
    const tight = layoutJobs([job("a"), job("b"), job("d")], "d", MORE_JOBS_WIDTH + 4 + 20);
    expect(tight.capsules.map(({ job: each, form }) => [each.key, form])).toEqual([["d", "disc"]]);
    expect(tight.more).toBe(2);
    // With room for its step once the discs are counted, it keeps its words.
    const counted = layoutJobs([job("a"), job("b"), job("d")], "d", MORE_JOBS_WIDTH + 4 + capsuleWidth(job("d"), "step"));
    expect(counted.capsules.map(({ job: each, form }) => [each.key, form])).toEqual([["d", "step"]]);
    expect(counted.more).toBe(2);
    // Even with nothing left, amber stays.
    expect(layoutJobs([job("m", "need"), job("n", "need")], "n", 10).capsules.map(({ job: each }) => each.key)).toEqual(["m", "n"]);
  });

  test("not measured yet: everything shows", () => {
    expect(layoutJobs(jobs, "d", null).capsules).toHaveLength(3);
  });
});

test("the mark counts what waits on you: the capsule piece's asks, or the jobs that need you when it has none", () => {
  const ask: PillAsk = { kind: "question", id: "q", text: "", choices: [], who: "", about: "", since: 0 };
  expect(needCount([job("a", "need"), job("b")], [])).toBe(1);
  expect(needCount([job("a", "need")], [ask, ask])).toBe(2);
  expect(needCount([], [])).toBe(0);
});

describe("the jobs' store", () => {
  function sources() {
    let tasks: readonly TaskView[] = [];
    const listeners = new Set<() => void>();
    const timers: Array<{ run: () => void; ms: number }> = [];
    let now = 0;
    let started = false;
    const none: never[] = [];
    const still = { subscribe: () => () => {}, getSnapshot: () => none };
    const store = new BarJobs({
      tasks: () =>
        started
          ? {
              subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
              },
              getSnapshot: () => tasks,
            }
          : null,
      agents: still,
      runs: still,
      asks: still,
      now: () => now,
      timers: {
        set: (run, ms) => {
          const timer = { run, ms };
          timers.push(timer);
          return timer;
        },
        clear: (handle) => {
          const at = timers.indexOf(handle as (typeof timers)[number]);
          if (at >= 0) timers.splice(at, 1);
        },
      },
    });
    return {
      store,
      start: () => {
        started = true;
      },
      set: (next: readonly TaskView[], at: number) => {
        now = at;
        tasks = next;
        for (const listener of listeners) listener();
      },
      /** Run the timers due by `at`. */
      advance: (at: number) => {
        const due = timers.splice(0);
        now = at;
        for (const timer of due) timer.run();
      },
    };
  }

  test("the Ask tasks start after the bars: they are looked for until they are there", () => {
    const { store, start, set, advance } = sources();
    expect(store.getSnapshot().jobs).toEqual([]);
    start();
    advance(500);
    set([task("a", "asking")], 600);
    expect(store.getSnapshot()).toMatchObject({ speaking: "task:a", jobs: [{ key: "task:a" }] });
    store.close();
  });

  test("a finished job falls silent by itself, and leaves once looked at", () => {
    const { store, start, set, advance } = sources();
    start();
    advance(0);
    let told = 0;
    store.subscribe(() => told++);
    set([task("a", "done")], 1000);
    expect(store.getSnapshot().speaking).toBe("task:a");
    advance(1000 + FIN_SPEAKS_MS + 1);
    expect(store.getSnapshot().speaking).toBeNull();
    expect(told).toBe(2);
    const [done] = store.getSnapshot().jobs;
    if (!done) throw new Error("no job");
    store.looked(done);
    expect(store.getSnapshot().jobs).toEqual([]);
    // The panel opened on all of them: every finished one goes, the ones at work stay.
    set([task("b", "done"), task("c", "running"), task("a", "done")], 20_000);
    store.lookedAll();
    expect(store.getSnapshot().jobs.map((job) => job.id)).toEqual(["c"]);
    store.close();
  });
});
