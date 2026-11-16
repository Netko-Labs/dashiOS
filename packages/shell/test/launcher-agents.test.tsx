import { afterEach, expect, test } from "bun:test";
import type { Outcome } from "../src/actions/types.ts";
import { ANSWERERS } from "../src/agents/ask/answerer.ts";
import type { HistoryEntry } from "../src/agents/ask/history.ts";
import type { NowItem } from "../src/agents/ask/now.ts";
import { LAUNCHER_RULES } from "../src/launcher/keys.ts";
import { ASK_ROW, agentVerbs, firstChoice, readsLikeSentence, SET_UP_ROW, withAgents } from "../src/launcher/lib/agents/agent-rows.ts";
import type { Section } from "../src/launcher/sections.ts";
import type { LauncherAgents, LauncherAgentsSnapshot } from "../src/launcher/types.ts";
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

test("Ask Dashi is the last row, only for a sentence or after ⇥, and says what answers (D261)", () => {
  expect(ids(withAgents(LOCAL, input("ter", snap())))).toEqual(["entry:app.terminal"]);
  expect(ids(withAgents(LOCAL, input("dark mode", snap())))).toEqual(["entry:app.terminal"]);
  const sentence = withAgents(LOCAL, input("dark mode and hide the dock", snap()));
  expect(ids(sentence)).toEqual(["entry:app.terminal", ASK_ROW]);
  const ask = sentence.at(-1)?.rows[0];
  expect(ask).toMatchObject({ title: "Ask Dashi", detail: "“dark mode and hide the dock”", kind: "Claude", agent: "ask" });
  const named = withAgents(LOCAL, { ...input("ter", snap({ answerer: ANSWERERS.local }), true), model: "Local model · qwen3:8b" }).at(-1)?.rows[0];
  expect(named).toMatchObject({ detail: "“ter” · Local model · qwen3:8b", kind: "" });
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
  // A plan (GPT by voice) has no view in the launcher any more: its row only stops it.
  expect(agentVerbs({ kind: "now", item: running }).map((verb) => verb.title)).toEqual(["Stop"]);
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
