import { describe, expect, test } from "bun:test";
import { chipState } from "../src/agents/handoff/chip.ts";
import { followUpPrompt, followUpRoute } from "../src/agents/handoff/follow-up.ts";
import { AgentRuns, progressWords, RETAIN_MS, statusWords, summaryLines } from "../src/agents/handoff/store.ts";

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, tick: (ms: number) => (now += ms) };
}

const start = (runs: AgentRuns, id = "run1", harness: "claude-code" | "codex" = "claude-code") =>
  runs.start({ id, request: "Book a spinning class at Bodytech", harness, harnessName: harness === "codex" ? "Codex" : "Claude Code" });

const question = {
  kind: "sign-in" as const,
  title: "Use your bodytech.com.co login?",
  detail: "Dashi · alexk",
  choices: [
    { id: "task", label: "Allow for this task" },
    { id: "deny", label: "Don't" },
  ],
  needs: "needs your OK to sign in",
};

describe("the agents' store", () => {
  test("start, steps from the stream, the plan's size, done with its last words", () => {
    const time = clock();
    const runs = new AgentRuns({ now: time.now });
    start(runs);
    expect(runs.get("run1")?.phase).toBe("starting");
    expect(statusWords(runs.get("run1") as never)).toBe("starting");
    runs.event("run1", { kind: "session", id: "s-1" });
    runs.event("run1", { kind: "said", text: "Steps: 4" });
    runs.event("run1", { kind: "call", id: "a", tool: "open_url", input: { url: "https://bodytech.com.co" } });
    let run = runs.get("run1");
    expect(run?.session).toBe("s-1");
    expect(run?.steps).toEqual([{ id: "1:a", words: "Opening bodytech.com.co", state: "running" }]);
    expect(progressWords(run as never)).toBe("step 1 of about 4");
    expect(statusWords(run as never)).toBe("opening bodytech.com.co");
    runs.event("run1", { kind: "result", id: "a", ok: true, text: "Opened" });
    runs.event("run1", { kind: "call", id: "b", tool: "sign_in", input: { site: "bodytech.com.co" } });
    runs.event("run1", { kind: "result", id: "b", ok: false, text: "refused" });
    run = runs.get("run1");
    expect(run?.steps.map((step) => [step.words, step.state])).toEqual([
      ["Opened bodytech.com.co", "done"],
      ["Couldn't: signing in to bodytech.com.co", "failed"],
    ]);
    time.tick(5_000);
    runs.event("run1", { kind: "done", text: "Booked your class for Thursday 7:00\nBodytech Chicó · added to Calendar" });
    run = runs.get("run1");
    expect(run?.phase).toBe("done");
    expect(run?.ended).toBe(time.now());
    expect(summaryLines(run?.summary ?? "")).toEqual({ title: "Booked your class for Thursday 7:00", body: "Bodytech Chicó · added to Calendar" });
    // The process's exit after the stream ended changes nothing.
    runs.exited("run1", 1);
    expect(runs.get("run1")?.phase).toBe("done");
  });

  test("more steps than it planned: about never goes under what it took", () => {
    const runs = new AgentRuns();
    start(runs);
    runs.event("run1", { kind: "said", text: "Steps: 1" });
    runs.event("run1", { kind: "call", id: "a", tool: "read_page", input: {} });
    runs.event("run1", { kind: "call", id: "b", tool: "read_page", input: {} });
    expect(progressWords(runs.get("run1") as never)).toBe("step 2 of about 2");
  });

  test("a question waits for the person's answer; a second waits its turn", async () => {
    const runs = new AgentRuns();
    start(runs);
    const first = runs.ask("run1", question);
    const second = runs.ask("run1", { ...question, title: "Second" });
    expect(runs.get("run1")?.question?.id).toBe(first.question.id);
    expect(statusWords(runs.get("run1") as never)).toBe("needs your OK to sign in");
    expect(runs.answer("run1", first.question.id, "task")).toBe(true);
    expect(await first.answer).toBe("task");
    expect(runs.get("run1")?.question?.title).toBe("Second");
    expect(runs.answer("run1", first.question.id, "task")).toBe(false);
    runs.answer("run1", second.question.id, null);
    expect(await second.answer).toBeNull();
    expect(runs.get("run1")?.question).toBeNull();
  });

  test("Stop: whatever ends it is 'stopped', and its question is taken back", async () => {
    const runs = new AgentRuns();
    start(runs);
    runs.event("run1", { kind: "call", id: "a", tool: "open_url", input: {} });
    const asked = runs.ask("run1", question);
    runs.stopping("run1");
    runs.exited("run1", 143);
    expect(runs.get("run1")?.phase).toBe("stopped");
    expect(runs.get("run1")?.steps[0]?.state).toBe("failed");
    expect(await asked.answer).toBeNull();
    // Nothing more is asked of a run that ended.
    expect(await runs.ask("run1", question).answer).toBeNull();
  });

  test("a stop before it started anything ends it at once", () => {
    const runs = new AgentRuns();
    start(runs);
    runs.stopping("run1");
    expect(runs.get("run1")?.phase).toBe("stopped");
  });

  test("an exit without a word is a failure with its code", () => {
    const runs = new AgentRuns();
    start(runs);
    runs.exited("run1", 2);
    expect(runs.get("run1")?.phase).toBe("failed");
    expect(statusWords(runs.get("run1") as never)).toBe("stopped · It ended with code 2.");
  });

  test("a follow-up starts its next turn, keeping its steps and session", () => {
    const runs = new AgentRuns();
    start(runs);
    runs.event("run1", { kind: "session", id: "s-1" });
    runs.event("run1", { kind: "call", id: "a", tool: "open_url", input: {} });
    runs.event("run1", { kind: "done", text: "All done" });
    runs.followUp("run1", "use the 7:30 one if 7 is full");
    const run = runs.get("run1");
    expect(run?.phase).toBe("starting");
    expect(run?.turn).toBe(2);
    expect(run?.session).toBe("s-1");
    expect(run?.messages.map((message) => message.text)).toEqual(["use the 7:30 one if 7 is full"]);
    // The same call id in the new turn is a new step.
    runs.event("run1", { kind: "call", id: "a", tool: "read_page", input: {} });
    expect(run && runs.get("run1")?.steps.map((step) => step.id)).toEqual(["1:a", "2:a"]);
  });

  test("Undo for its settings changes", () => {
    const runs = new AgentRuns();
    start(runs);
    runs.changed("run1", { address: "dashi://settings/set", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" });
    runs.undone("run1", 0);
    expect(runs.get("run1")?.undos).toEqual([
      { undo: { address: "dashi://settings/set", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" }, undone: true },
    ]);
  });

  test("a finished run stays an hour; a working one stays", () => {
    const time = clock();
    const runs = new AgentRuns({ now: time.now });
    start(runs, "old");
    start(runs, "busy");
    runs.event("old", { kind: "done", text: "ok" });
    time.tick(RETAIN_MS - 1);
    expect(runs.prune()).toEqual([]);
    time.tick(2);
    expect(runs.prune()).toEqual(["old"]);
    expect(runs.getSnapshot().map((run) => run.id)).toEqual(["busy"]);
  });

  test("newest first", () => {
    const time = clock();
    const runs = new AgentRuns({ now: time.now });
    start(runs, "a");
    time.tick(10);
    start(runs, "b");
    expect(runs.getSnapshot().map((run) => run.id)).toEqual(["b", "a"]);
  });
});

describe("the menu bar's chip", () => {
  test("none while nothing works", () => {
    const runs = new AgentRuns();
    expect(chipState(runs.getSnapshot())).toBeNull();
    start(runs);
    runs.event("run1", { kind: "done", text: "ok" });
    expect(chipState(runs.getSnapshot())).toBeNull();
  });

  test("one agent: its harness and what it does", () => {
    const runs = new AgentRuns();
    start(runs);
    expect(chipState(runs.getSnapshot())?.words).toBe("Claude Code · Starting");
    runs.event("run1", { kind: "call", id: "a", tool: "sign_in", input: { site: "bodytech.com.co" } });
    expect(chipState(runs.getSnapshot())).toEqual({ words: "Claude Code · Signing in to bodytech.com.co", attention: false, count: 1, run: "run1" });
  });

  test("two: how many, and the newest's words", () => {
    const time = clock();
    const runs = new AgentRuns({ now: time.now });
    start(runs, "a", "codex");
    time.tick(1);
    start(runs, "b");
    runs.event("b", { kind: "call", id: "x", tool: "sign_in", input: { site: "bodytech.com.co" } });
    expect(chipState(runs.getSnapshot())?.words).toBe("2 agents · Claude Code is signing in to bodytech.com.co");
  });

  test("amber while one needs the person, whichever it is", () => {
    const time = clock();
    const runs = new AgentRuns({ now: time.now });
    start(runs, "a", "codex");
    time.tick(1);
    start(runs, "b");
    runs.ask("a", question);
    expect(chipState(runs.getSnapshot())).toEqual({ words: "2 agents · Codex needs you", attention: true, count: 2, run: "a" });
  });
});

describe("follow-ups", () => {
  test("working with a session: stopped and resumed with the words", () => {
    expect(followUpRoute({ phase: "working", session: "s", request: "r" }, "t")).toEqual({ kind: "restart", session: "s" });
  });
  test("still starting: the words wait for its session", () => {
    expect(followUpRoute({ phase: "starting", session: null, request: "r" }, "t")).toEqual({ kind: "wait" });
  });
  test("ended: resumed in its session", () => {
    expect(followUpRoute({ phase: "done", session: "s", request: "r" }, "t")).toEqual({ kind: "resume", session: "s" });
    expect(followUpRoute({ phase: "stopped", session: "s", request: "r" }, "t")).toEqual({ kind: "resume", session: "s" });
  });
  test("ended before it had a session: a new start with both", () => {
    expect(followUpRoute({ phase: "failed", session: null, request: "Book it" }, "at 7:30")).toEqual({ kind: "start-over", prompt: "Book it\n\nat 7:30" });
  });
  test("what the harness hears", () => {
    expect(followUpPrompt("at 7:30", true)).toContain("stopped you to add this");
    expect(followUpPrompt("at 7:30", false)).toEndWith("at 7:30");
  });
});
