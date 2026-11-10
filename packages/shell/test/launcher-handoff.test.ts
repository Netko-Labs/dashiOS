import { describe, expect, test } from "bun:test";
import { attentionNotice, endedNotice, logText } from "../src/agents/handoff/notices.ts";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import { ASK_ROW } from "../src/launcher/agent-rows.ts";
import {
  type HandoffSnapshot,
  handoffHints,
  harnessByDigit,
  namesFound,
  readsLikeTask,
  runRow,
  runsToList,
  showsContext,
  withHandoff,
} from "../src/launcher/handoff-rows.ts";
import { extraRules, LauncherKeys, NO_EXTRA_KEYS } from "../src/launcher/keys.ts";
import type { Row } from "../src/launcher/row-model.ts";
import type { Section } from "../src/launcher/sections.ts";

const harnesses: HandoffSnapshot["harnesses"] = [
  { id: "claude-code", name: "Claude Code", uses: "your Claude subscription", signedIn: true },
  { id: "codex", name: "Codex", uses: "your ChatGPT plan", signedIn: null },
];
const snapshot = (runs: HandoffSnapshot["runs"] = []): HandoffSnapshot => ({ harnesses, runs });

const row = (id: string, title: string, kind = "App"): Row => ({ id, title, kind, icon: { glyph: "" }, action: { kind: "all-apps" } });
const ask: Section = {
  id: "ask",
  rows: [{ ...row(ASK_ROW, "Ask: …", "Claude Code · your Claude subscription"), action: { kind: "agent", act: { kind: "ask", query: "x" } } }],
};

const ids = (sections: readonly Section[]) => sections.map((section) => section.id);

describe("Hand it off in the launcher", () => {
  test("words that read as a task", () => {
    expect(readsLikeTask("book a spinning class at bodytech thursday 7am")).toBe(true);
    expect(readsLikeTask("rename screenshots by date")).toBe(true);
    expect(readsLikeTask("my invoices from this week please")).toBe(true);
    expect(readsLikeTask("what time is it in tokyo?")).toBe(false);
    expect(readsLikeTask("visual studio code")).toBe(false);
    expect(readsLikeTask("notes")).toBe(false);
  });

  test("a task puts Hand it off first, one row per harness (Return's first), Ask under Right now", () => {
    const query = "book a spinning class at bodytech thursday 7am";
    const found: Section[] = [{ id: "results", rows: [row("file:1", "class schedule.pdf", "File")] }, ask];
    const sections = withHandoff(found, { query, allApps: false, snapshot: snapshot(), tabbed: false });
    expect(ids(sections)).toEqual(["handoff", "ask", "results"]);
    expect(sections[0]?.title).toBe("Hand it off");
    expect(sections[0]?.rows.map((each) => [each.title, each.detail, each.shortcut])).toEqual([
      ["Start Claude Code", "works in the background · signs in through Dashi", undefined],
      ["Start Codex", "your ChatGPT plan", "⌥1"],
    ]);
    expect(sections[0]?.rows[0]?.action).toEqual({ kind: "agent", act: { kind: "hand-off", harness: "claude-code", query } });
    expect(sections[1]?.title).toBe("Right now");
    expect(sections[1]?.rows[0]).toMatchObject({ title: "Ask", shortcut: "⇥" });
  });

  test("an app's or a setting's name still finds it first: the ranking decides", () => {
    const query = "turn on dark mode now please";
    const found: Section[] = [{ id: "top", title: "Top hit", rows: [row("setting:dark", "Dark Mode", "Settings")] }, ask];
    expect(namesFound(query, found)).toBe(true);
    expect(ids(withHandoff(found, { query, allApps: false, snapshot: snapshot(), tabbed: false }))).toEqual(["top", "handoff", "ask"]);
    const app: Section[] = [{ id: "top", rows: [row("app:code", "Visual Studio Code")] }];
    expect(namesFound("visual studio co", app)).toBe(true);
  });

  test("not for a word or two, after ⇥ (that asks), or with no harness installed", () => {
    expect(ids(withHandoff([ask], { query: "notes", allApps: false, snapshot: snapshot(), tabbed: false }))).toEqual(["ask"]);
    expect(ids(withHandoff([ask], { query: "book a class at bodytech", allApps: false, snapshot: snapshot(), tabbed: true }))).toEqual(["ask"]);
    expect(ids(withHandoff([ask], { query: "book a class at bodytech", allApps: false, snapshot: { harnesses: [], runs: [] }, tabbed: false }))).toEqual([
      "ask",
    ]);
  });

  test("a harness that isn't signed in: Return opens Terminal", () => {
    const sections = withHandoff([], {
      query: "book a class at bodytech",
      allApps: false,
      snapshot: { harnesses: [{ ...harnesses[0], signedIn: false } as never], runs: [] },
      tabbed: false,
    });
    expect(sections[0]?.rows[0]?.action).toEqual({ kind: "agent", act: { kind: "sign-in-harness", harness: "claude-code" } });
  });

  test("⌥1 picks the second harness, ⌥2 the third", () => {
    expect(harnessByDigit(snapshot(), 1)).toBe("codex");
    expect(harnessByDigit(snapshot(), 2)).toBeNull();
  });

  test("the chips show with words that read as a request, while a harness is there", () => {
    expect(showsContext("book a class at bodytech", snapshot())).toBe(true);
    expect(showsContext("notes", snapshot())).toBe(false);
    expect(showsContext("book a class at bodytech", { harnesses: [], runs: [] })).toBe(false);
    // Ask gets the chips too: with an answerer and no harness, they still show.
    expect(showsContext("book a class at bodytech", { harnesses: [], runs: [] }, true)).toBe(true);
  });
});

describe("runs on the empty launcher", () => {
  const runs = new AgentRuns({ now: () => 1_000 });
  runs.start({ id: "a", request: "Summarize this week's invoices", harness: "codex", harnessName: "Codex" });
  runs.start({ id: "b", request: "Book a spinning class", harness: "claude-code", harnessName: "Claude Code" });
  runs.event("a", { kind: "call", id: "1", tool: "read_page", input: {} });
  runs.ask("b", { kind: "sign-in", title: "Use your bodytech.com.co login?", detail: "", choices: [], needs: "needs your OK to sign in" });
  runs.start({ id: "c", request: "Rename screenshots", harness: "claude-code", harnessName: "Claude Code" });
  runs.event("c", { kind: "done", text: "Renamed 23 files\nin Pictures/Screenshots, by the date each was taken" });

  test("Agents first: the one waiting on you, then working, then ended", () => {
    const sections = withHandoff([{ id: "recent", title: "Recent", rows: [] }], {
      query: "",
      allApps: false,
      snapshot: snapshot(runs.getSnapshot()),
      tabbed: false,
    });
    expect(ids(sections)).toEqual(["agents", "recent"]);
    expect(runsToList(runs.getSnapshot()).map((run) => run.id)).toEqual(["b", "a", "c"]);
    const [waiting, working, ended] = sections[0]?.rows ?? [];
    expect(waiting).toMatchObject({ title: "Book a spinning class", detail: "needs your OK to sign in", attention: true, stop: true });
    expect(working).toMatchObject({ detail: "reading the page", kind: "step 1" });
    expect(ended?.stop).toBeUndefined();
    // The first line of its last words only.
    expect(ended?.detail).toBe("done · Renamed 23 files");
  });

  test("their keys at the field's end", () => {
    const run = runs.get("a");
    expect(handoffHints(run ? runRow(run) : undefined)?.map((hint) => hint.keys)).toEqual(["↩", "⇥", "❖⌫"]);
  });
});

describe("the launcher's agents' keys", () => {
  test("bound only while they mean something", () => {
    expect(extraRules(NO_EXTRA_KEYS)).toEqual([]);
    expect(extraRules({ option: true, stop: true, backspace: true, settings: true }).map((rule) => rule.when)).toEqual([
      "alt+1",
      "alt+2",
      "alt+3",
      "alt+4",
      "alt+5",
      "alt+6",
      "alt+7",
      "alt+8",
      "alt+9",
      "super+BackSpace",
      "BackSpace",
      "super+comma",
    ]);
  });

  test("their bindings reach the open launcher as commands", () => {
    const keys = new LauncherKeys();
    const heard: unknown[] = [];
    keys.subscribeCommands((command) => heard.push(command));
    expect(keys.binding("launcher-option-1")).toBe(true);
    expect(keys.binding("launcher-stop")).toBe(true);
    expect(keys.binding("launcher-backspace")).toBe(true);
    expect(heard).toEqual([{ kind: "option-pick", digit: 1 }, { kind: "stop" }, { kind: "backspace" }]);
    let told = 0;
    keys.onExtras = () => told++;
    keys.extras({ ...NO_EXTRA_KEYS, stop: true });
    keys.extras({ ...NO_EXTRA_KEYS, stop: true });
    expect(told).toBe(1);
  });
});

describe("the notifications", () => {
  const runs = new AgentRuns({ now: () => 0 });
  runs.start({ id: "a", request: "Book a spinning class", harness: "claude-code", harnessName: "Claude Code" });

  test("done: its last words, Show and Follow up", () => {
    runs.event("a", { kind: "done", text: "Booked your class for Thursday 7:00\nBodytech Chicó · added to Calendar" });
    const notice = endedNotice(runs.get("a") as never);
    expect(notice).toMatchObject({ appName: "Claude Code", summary: "Booked your class for Thursday 7:00", body: "Bodytech Chicó · added to Calendar" });
    expect(notice?.actions.map((action) => action.label)).toEqual(["Show", "Follow up"]);
    expect(logText(runs.get("a") as never)).toContain("Booked your class");
  });

  test("stopped by the person: none; a question with the panel closed: one", () => {
    runs.start({ id: "b", request: "x", harness: "codex", harnessName: "Codex" });
    runs.stopping("b");
    expect(endedNotice(runs.get("b") as never)).toBeNull();
    runs.start({ id: "c", request: "Book it", harness: "codex", harnessName: "Codex" });
    const { question } = runs.ask("c", { kind: "site", title: "Use bodytech.com.co?", detail: "", choices: [], needs: "" });
    expect(attentionNotice(runs.get("c") as never, question).summary).toBe("Codex needs you");
    expect(attentionNotice(runs.get("c") as never, question).body).toBe(`${question.title} · For “${runs.get("c")?.request}”`);
  });
});
