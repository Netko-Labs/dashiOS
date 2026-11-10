import { expect, test } from "bun:test";
import { AnswerError } from "../src/agents/ask/answerer.ts";
import { FAILED_STAYS_MS } from "../src/agents/ask/lib/task-types.ts";
import { nowItems, TurnWatch } from "../src/agents/ask/now.ts";
import { darkAndDock, fakeAnswerer, harness } from "./support/agents-ask-tasks.ts";
import { settle } from "./support/time.ts";

test("a failed ask leaves Now a while after (or once the launcher closes), and stays in the history", async () => {
  const pending: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const timers = {
    set: (run: () => void, ms: number) => {
      const timer = { run, ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const fire = () => {
    for (const timer of pending.splice(0)) if (!timer.cleared) timer.run();
  };
  const answerer = fakeAnswerer([
    new AnswerError("no-answer", "Claude didn't answer."),
    new AnswerError("no-answer", "Claude didn't answer."),
    darkAndDock,
    new AnswerError("no-answer", "Claude didn't answer."),
  ]);
  const { tasks, kept } = harness(answerer, { timers });
  const now = () => nowItems({ turns: [], tasks: tasks.getSnapshot(), agents: [] }).map((item) => item.kind === "task" && item.status);
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  expect(now()).toEqual(["dark mode and hide the dock · didn't answer"]);
  expect(pending.map((timer) => timer.ms)).toEqual([FAILED_STAYS_MS]);
  // Kept as the plan it would have been, saying why there was none.
  expect(kept).toEqual([{ task: `${id}.1`, time: 1000, agent: "Claude", request: "dark mode and hide the dock", steps: [], failure: "Claude didn't answer." }]);
  fire();
  expect(now()).toEqual([]);
  // Its plan is still there to Retry; a Retry is back in Now while it asks.
  expect(tasks.get(id)).toMatchObject({ phase: "failed", leftNow: true });
  tasks.retry(id);
  expect(now()).toEqual(["dark mode and hide the dock · planning"]);
  await settle();
  expect(now()).toEqual(["dark mode and hide the dock · didn't answer"]);
  // The launcher closes: it goes at once, and its timer with it.
  tasks.letFailedGo();
  expect(now()).toEqual([]);
  expect(pending.every((timer) => timer.cleared)).toBe(true);
  tasks.retry(id);
  await settle();
  expect(tasks.get(id)?.phase).toBe("planned");
  expect(tasks.get(id)?.leftNow).toBeUndefined();
  // A failure after a plan stays in Now again, and a failed line never stands for a plan that ran.
  tasks.followUp(id, "and mute");
  await settle();
  expect(now()).toEqual(["and mute · didn't answer"]);
});

test("nothing to do: the model's words, and the task leaves Now", async () => {
  const { tasks } = harness(fakeAnswerer([[]]));
  const id = tasks.ask("paint my house") as string;
  await settle();
  expect(tasks.get(id)).toMatchObject({ phase: "done", said: "I can't do that here.", steps: [] });
  expect(nowItems({ turns: [], tasks: tasks.getSnapshot(), agents: [] })).toEqual([]);
});

test("Now: a Your turn first, then the launcher's tasks, then agents (not twice for one handing over)", async () => {
  const watch = new TurnWatch();
  let done: (value: boolean) => void = () => {};
  const turn = { agent: 2, who: { name: "claude", detail: "", claims: null, remote: false }, reason: "enter the code from your bank", window: 7 };
  void watch.track(turn, new Promise<boolean>((resolve) => (done = resolve)));
  const { tasks } = harness(fakeAnswerer([darkAndDock]));
  tasks.ask("dark mode and hide the dock");
  await settle();
  const items = nowItems({
    turns: watch.getSnapshot(),
    tasks: tasks.getSnapshot(),
    agents: [
      { id: 2, name: "claude", status: "Waiting for you", scopes: [] },
      { id: 3, name: "codex", status: "Sorting Downloads", scopes: [] },
    ],
  });
  expect(items).toEqual([
    { kind: "turn", agent: 2, name: "claude", reason: "enter the code from your bank", window: 7 },
    { kind: "task", id: expect.any(String), name: "Claude", status: "dark mode and hide the dock · 2 steps ready", phase: "planned" },
    { kind: "agent", id: 3, name: "codex", status: "Sorting Downloads" },
  ]);
  done(true);
  await settle();
  expect(watch.getSnapshot()).toEqual([]);
});
