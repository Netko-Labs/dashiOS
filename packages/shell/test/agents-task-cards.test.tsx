/**
 * The launcher's Ask tasks in the agents' panel (agents-panel/tasks.tsx,
 * lib/task-cards.tsx): what a click on a task's capsule in the menu bar
 * opens. Steps, Stop, the result and Undo, and a plan's "Answer".
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import type { TaskView } from "../src/agents/index.ts";
import { AgentsPanel, type PanelActions, type PanelTasks, panelTasks, withPanelTasks } from "../src/agents-panel/index.ts";
import { panelTaskList, taskLine } from "../src/agents-panel/lib/task-cards.tsx";
import { settle } from "./support/time.ts";

type Step = TaskView["steps"][number];
const step = (id: string, title: string, state: Step["state"], extra: Partial<Step> = {}): Step => ({
  id,
  tool: "set_setting",
  action: null,
  args: {},
  title,
  scope: null,
  asks: false,
  state,
  ...extra,
});

const task = (id: string, phase: TaskView["phase"], extra: Partial<TaskView> = {}): TaskView => ({
  id,
  answerer: { id: "claude", name: "Claude", where: "" },
  request: "turn on dark mode",
  phase,
  steps: [],
  said: "",
  failure: null,
  ...extra,
});

const none: never[] = [];
const still = { subscribe: () => () => {}, getSnapshot: () => none };
const noActions: PanelActions = { answer() {}, stop() {}, show() {}, undo() {}, stopAgent() {}, stopAll() {} };

function open(tasks: readonly TaskView[], actions: PanelActions = noActions) {
  const trees: string[] = [];
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  const log: string[] = [];
  const source: PanelTasks = {
    subscribe: () => () => {},
    getSnapshot: () => tasks,
    stop: (id) => log.push(`stop ${id}`),
    undo: (id, index, undo) => log.push(`undo ${id} ${index} ${undo.title}`),
    answer: (id) => log.push(`answer ${id}`),
  };
  const panel = withPanelTasks(
    ({ focus }: { focus: string | null }) => <AgentsPanel runs={still} agents={still} right={400} focus={focus} actions={actions} onClose={() => {}} />,
    source,
  );
  if (!panel) throw new Error("no panel");
  const root = render(panel({ focus: null }), transport);
  const press = (testID: string) => {
    const id = root.nodeId(testID);
    if (!id) throw new Error(`no ${testID}`);
    for (const listener of listeners) listener({ type: "press", nodeId: id });
  };
  return { root, trees, log, press };
}

describe("a task's card", () => {
  test("at work: what was asked, who answers, its steps, and Stop", async () => {
    const running = task("a", "running", {
      steps: [step("1", "Turn Dark Mode on", { kind: "done", text: "" }), step("2", "Set the volume to 40%", { kind: "running" })],
    });
    const { root, trees, log, press } = open([running]);
    await settle();
    const tree = trees.at(-1) ?? "";
    expect(tree).toContain("turn on dark mode");
    expect(tree).toContain("Claude · Step 2 of 2");
    expect(tree).toContain("Turn Dark Mode on");
    expect(tree).toContain("Set the volume to 40%");
    press("agents-task-stop:a");
    expect(log).toEqual(["stop a"]);
    root.unmount();
  });

  test("finished: its result, and Undo where a change can be put back", async () => {
    const undo = { address: "dashi://settings/set", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" };
    const done = task("a", "done", { said: "Dark Mode is on.", steps: [step("1", "Turn Dark Mode on", { kind: "done", text: "" }, { undo })] });
    const { root, trees, log, press } = open([done]);
    await settle();
    expect(trees.at(-1)).toContain("Dark Mode is on.");
    expect(trees.at(-1)).toContain("Undo: Turn Dark Mode off");
    expect(root.nodeId("agents-task-stop:a")).toBeUndefined();
    press("agents-task-undo:a:0");
    expect(log).toEqual(["undo a 0 Turn Dark Mode off"]);
    root.unmount();
  });

  test("a plan that waits for a yes is answered elsewhere: Answer, and Stop", async () => {
    const { root, trees, log, press } = open([task("a", "planned", { steps: [step("1", "Turn Dark Mode on", { kind: "ready" })] })]);
    await settle();
    expect(trees.at(-1)).toContain("Claude · Waiting for you");
    press("agents-task-answer:a");
    press("agents-task-stop:a");
    expect(log).toEqual(["answer a", "stop a"]);
    root.unmount();
  });

  test("Stop all stops the tasks at work, then the agents", async () => {
    const stopped: string[] = [];
    const { root, log, press } = open([task("a", "asking"), task("b", "done")], { ...noActions, stopAll: () => stopped.push("agents") });
    await settle();
    press("agents-stop-all");
    expect(log).toEqual(["stop a"]);
    expect(stopped).toEqual(["agents"]);
    root.unmount();
  });
});

test("the panel lists tasks at work first, then a few that ended; stopped ones and failures that left are not there", () => {
  const list = panelTaskList([
    task("done-new", "done"),
    task("run", "running"),
    task("stopped", "stopped"),
    task("left", "failed", { leftNow: true }),
    task("failed", "failed", { failure: { kind: "no-answer", text: "The local model didn't answer." } }),
  ]);
  expect(list.map((each) => each.id)).toEqual(["run", "done-new", "failed"]);
  expect(taskLine(list[2] as TaskView)).toBe("Claude · The local model didn't answer.");
});

test("before the Ask tasks have started the panel has none, and nothing throws", () => {
  const tasks = panelTasks(
    () => null,
    () => {},
  );
  expect(tasks.getSnapshot()).toEqual([]);
  tasks.stop("a");
  tasks.subscribe(() => {})();
});
