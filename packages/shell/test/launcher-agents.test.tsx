import { afterEach, expect, test } from "bun:test";
import type { Outcome } from "../src/actions/types.ts";
import { ANSWERERS } from "../src/agents/ask/answerer.ts";
import type { HistoryEntry } from "../src/agents/ask/history.ts";
import type { NowItem } from "../src/agents/ask/now.ts";
import { stepsFrom } from "../src/agents/ask/plan.ts";
import type { TaskView } from "../src/agents/ask/tasks.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import {
  ASK_ROW,
  agentVerbs,
  firstChoice,
  type LauncherAgents,
  type LauncherAgentsSnapshot,
  readsLikeSentence,
  SET_UP_ROW,
  withAgents,
} from "../src/launcher/agents/rows.ts";
import { agentField, taskSubmit } from "../src/launcher/agents/task-mode.tsx";
import { LAUNCHER_RULES, LauncherKeys } from "../src/launcher/keys.ts";
import type { Section } from "../src/launcher/rows.ts";
import { app, mount, unmountLauncher } from "./launcher-harness.tsx";

afterEach(unmountLauncher);

const LOCAL: Section[] = [
  { id: "results", rows: [{ id: "entry:app.terminal", title: "Terminal", kind: "App", icon: { image: "/t.svg" }, action: { kind: "type", query: "" } }] },
];
const snap = (over: Partial<LauncherAgentsSnapshot> = {}): LauncherAgentsSnapshot => ({
  answerer: ANSWERERS.claude,
  unset: false,
  now: [],
  tasks: [],
  ...over,
});
const ids = (sections: readonly Section[]) => sections.flatMap((section) => section.rows.map((row) => row.id));
const input = (query: string, snapshot: LauncherAgentsSnapshot | null, tabbed = false) => ({ query, allApps: false, snapshot, tabbed, now: 1000 });

test("a sentence: three words or more, a verb first, or a question; never a name", () => {
  for (const words of ["dark mode and hide the dock", "turn on dark mode", "mute it", "why is it slow?"]) expect(readsLikeSentence(words)).toBe(true);
  for (const words of ["ter", "dark mode", "wi-fi", "?"]) expect(readsLikeSentence(words)).toBe(false);
  // Three words that are a sum get their answer, not an Ask.
  const sum: Section[] = [
    { id: "results", rows: [{ id: "answer", title: "12", kind: "Answer", icon: { image: "/c.svg" }, action: { kind: "copy", text: "12" } }] },
  ];
  expect(ids(withAgents(sum, input("15% of 80", snap())))).toEqual(["answer"]);
  expect(ids(withAgents(sum, input("15% of 80", snap(), true)))).toEqual(["answer", ASK_ROW]);
});

test("Ask is the last row, only for a sentence or after ⇥, and says where the words go", () => {
  expect(ids(withAgents(LOCAL, input("ter", snap())))).toEqual(["entry:app.terminal"]);
  expect(ids(withAgents(LOCAL, input("dark mode", snap())))).toEqual(["entry:app.terminal"]);
  const sentence = withAgents(LOCAL, input("dark mode and hide the dock", snap()));
  expect(ids(sentence)).toEqual(["entry:app.terminal", ASK_ROW]);
  const ask = sentence.at(-1)?.rows[0];
  expect(ask).toMatchObject({ title: "Ask: dark mode and hide the dock", kind: "Claude · Anthropic, your key", agent: "ask" });
  expect(withAgents(LOCAL, input("ter", snap({ answerer: ANSWERERS.local }), true)).at(-1)?.rows[0]?.kind).toBe("Local · stays on this computer");
});

test("never picked: ⇥ offers Set up an agent…; None hides Ask entirely", () => {
  const unset = snap({ answerer: null, unset: true });
  expect(ids(withAgents(LOCAL, input("dark mode and hide the dock", unset)))).toEqual(["entry:app.terminal"]);
  expect(ids(withAgents(LOCAL, input("dark mode and hide the dock", unset, true)))).toEqual(["entry:app.terminal", SET_UP_ROW]);
  const none = snap({ answerer: null, unset: false });
  expect(ids(withAgents(LOCAL, input("dark mode and hide the dock", none, true)))).toEqual(["entry:app.terminal"]);
  expect(ids(withAgents(LOCAL, input("dark mode and hide the dock", null, true)))).toEqual(["entry:app.terminal"]);
});

test("the selection with nothing held is never Ask", () => {
  expect(firstChoice([ASK_ROW])).toBeNull();
  expect(firstChoice(["search-files", ASK_ROW])).toBe("search-files");
});

const turn: NowItem = { kind: "turn", agent: 2, name: "claude", reason: "enter the code from your bank", window: 7 };
const running: NowItem = { kind: "task", id: "ask-1", name: "Claude", status: "dark mode · 1 of 2", phase: "running" };

test("Now sits on top of an empty launcher, at most three, each with a shiso dot and Stop", () => {
  const now = withAgents(
    LOCAL,
    input("", snap({ now: [turn, running, { kind: "agent", id: 3, name: "codex", status: "Idle" }, { kind: "agent", id: 4, name: "x", status: "Idle" }] })),
  );
  expect(now[0]?.title).toBe("Now");
  expect(now[0]?.rows.map((row) => [row.id, row.detail, row.agent, row.stop])).toEqual([
    ["now:turn:2", "Your turn: enter the code from your bank", "dot", true],
    ["now:task:ask-1", "dark mode · 1 of 2", "dot", true],
    ["now:agent:3", "Idle", "dot", true],
  ]);
  expect(withAgents(LOCAL, { ...input("", snap({ now: [turn] })), allApps: true })[0]?.id).toBe("results");
  // Enter on a Your turn goes to its window; Stop is there too.
  expect(agentVerbs({ kind: "now", item: turn }).map((verb) => verb.title)).toEqual(["Go to window", "Stop claude"]);
  expect(agentVerbs({ kind: "now", item: running }).map((verb) => verb.title)).toEqual(["Show plan", "Stop"]);
});

test("history lists what agents did, with Undo for a settings change", () => {
  const entry: HistoryEntry = {
    id: "ask-1.1",
    time: 400,
    who: "Claude",
    request: "dark mode",
    steps: [
      {
        title: "Turn Dark Mode on",
        outcome: "done",
        undo: { address: "dashi://tool/set-setting", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" },
      },
    ],
    summary: "Turn Dark Mode on",
  };
  const sections = withAgents([{ id: "nothing", title: "Nothing called “history”", rows: [] }], { ...input("history", snap()), history: () => [entry] });
  expect(sections.map((section) => section.id)).toEqual(["history"]);
  expect(sections[0]?.rows[0]).toMatchObject({ title: "Claude: dark mode", detail: "Turn Dark Mode on · 10 min ago" });
  expect(agentVerbs({ kind: "history", entry }).map((verb) => verb.title)).toEqual(["Show in Settings", "Undo: Turn Dark Mode off"]);
});

const planned = (): TaskView => ({
  id: "ask-1",
  answerer: ANSWERERS.claude,
  request: "dark mode and hide the dock",
  phase: "planned",
  steps: stepsFrom(
    [
      { id: "a", name: "set_setting", input: { name: "dark_mode", value: true } },
      { id: "b", name: "set_setting", input: { name: "dock_autohide", value: true } },
    ],
    TOOL_ACTIONS,
  ),
  said: "",
  failure: null,
});

test("Return on a plan: run it; with words typed, a follow-up; on a refused step, Allow once; failed, Retry or Settings", () => {
  const task = planned();
  expect(taskSubmit(task, "", null)).toEqual({ kind: "run" });
  expect(taskSubmit(task, " and lock ", null)).toEqual({ kind: "follow-up", text: "and lock" });
  const refused = { ...task, steps: task.steps.map((step) => ({ ...step, state: { kind: "not-allowed" as const } })) };
  expect(taskSubmit(refused, "", 1)).toEqual({ kind: "allow-once", step: 1 });
  expect(taskSubmit({ ...task, phase: "failed", failure: { kind: "no-answer", text: "Claude didn't answer." } }, "", null)).toEqual({ kind: "retry" });
  expect(taskSubmit({ ...task, phase: "failed", failure: { kind: "no-key", text: "No key." } }, "", null)).toEqual({ kind: "settings" });
  expect(taskSubmit({ ...task, phase: "running" }, "more", null)).toEqual({ kind: "none" });
  expect(agentField(task, "", "#6E56CF").hints.map((hint) => hint.label)).toEqual(["Run 2", "Edit", "back"]);
  expect(agentField(task, "", "#6E56CF").chip).toEqual({ title: "dark mode and hide the dock" });
});

test("⇥ is the launcher's while it is open, but ❖⇥ still switches apps", () => {
  const tab = LAUNCHER_RULES.find((rule) => rule.bind === "launcher-tab");
  expect(tab?.when).toBe("Tab|ISO_Left_Tab");
});

/** A store of the launcher's agents for the view: what it was asked, and a plan it hands back. */
function fakeAgents(snapshot: LauncherAgentsSnapshot): LauncherAgents & { asked: string[]; runs: string[]; set(next: LauncherAgentsSnapshot): void } {
  let current = snapshot;
  const listeners = new Set<() => void>();
  const asked: string[] = [];
  const runs: string[] = [];
  const done: Outcome = { ok: true, text: "" };
  return {
    asked,
    runs,
    set(next) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    ask(request) {
      asked.push(request);
      return "ask-1";
    },
    followUp: () => true,
    run: (task) => void runs.push(task),
    allowOnce: () => {},
    retry: () => {},
    undo: async () => done,
    entryOf: () => "ask-1.1",
    stop: () => {},
    goTo: async () => {},
    setUp: () => {},
    signIn: () => void runs.push("sign-in"),
    history: () => [],
  };
}

test("view: ter ↩ opens Terminal at once with an answerer set, and a sentence adds Ask last, unselected", async () => {
  const agents = fakeAgents(snap());
  const launcher = await mount({ entries: [app("Terminal")], agents }, ["entry:app.terminal", ASK_ROW]);
  await launcher.type("ter");
  expect(launcher.rows().ids).toEqual(["entry:app.terminal"]);
  await launcher.enter();
  expect(launcher.opened).toEqual(["Terminal"]);
  expect(agents.asked).toEqual([]);
});

test("view: ⇥ asks, the plan shows its steps under the spark, and Return runs it", async () => {
  const agents = fakeAgents(snap());
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [app("Terminal")], agents, keys }, [ASK_ROW]);
  await launcher.type("dark mode and hide the dock");
  expect(launcher.rows().ids).toEqual([ASK_ROW]);
  expect(launcher.rows().selected).toBeNull();
  keys.binding("launcher-tab");
  await new Promise((done) => setTimeout(done, 10));
  expect(agents.asked).toEqual(["dark mode and hide the dock"]);
  agents.set(snap({ tasks: [planned()] }));
  await new Promise((done) => setTimeout(done, 10));
  expect(launcher.has("launcher:section:plan")).toBe(true);
  expect(launcher.has("launcher:step:0")).toBe(true);
  expect(launcher.has("launcher:chip:1")).toBe(true);
  expect(launcher.tree()).toContain("Turn Dark Mode on");
  expect(launcher.tree()).toContain("Change settings · allowed");
  await launcher.enter();
  expect(agents.runs).toEqual(["ask-1"]);
  // Esc goes back to searching; the task keeps going.
  await launcher.key("Escape");
  expect(launcher.has("launcher:section:plan")).toBe(false);
});

test("view: after a plan ran, the field takes the next words alone; the plan's never come back into it", async () => {
  const agents = fakeAgents(snap());
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [app("Terminal")], agents, keys }, [ASK_ROW]);
  const value = (): string | undefined => /"value":"([^"]*)"/.exec(launcher.tree())?.[1];
  await launcher.type("dark mode and hide the dock");
  keys.binding("launcher-tab");
  await new Promise((done) => setTimeout(done, 10));
  agents.set(snap({ tasks: [{ ...planned(), phase: "done" }] }));
  await new Promise((done) => setTimeout(done, 10));
  // On the plan the words are its chip; the field is empty for a follow-up.
  expect(value()).toBe("");
  await launcher.key("Escape");
  // Back to searching: an empty field, not the plan's words for "history" to be typed after.
  expect(value()).toBe("");
  await launcher.type("history");
  expect(value()).toBe("history");
  // ⇥ on a plan still edits its words.
  agents.set(snap({ tasks: [planned()] }));
  await launcher.type("");
  await launcher.type("dark mode and hide the dock");
  keys.binding("launcher-tab");
  await new Promise((done) => setTimeout(done, 10));
  keys.binding("launcher-tab");
  await new Promise((done) => setTimeout(done, 10));
  expect(value()).toBe("dark mode and hide the dock");
});
