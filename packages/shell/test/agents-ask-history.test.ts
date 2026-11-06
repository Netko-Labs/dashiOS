import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ago, HistoryLog, readHistory, taskSummary } from "../src/agents/ask/history.ts";
import { callsSummary, groupSessions, spanWords } from "../src/agents/ask/sessions.ts";

const lines = (...values: unknown[]) => values.map((value) => JSON.stringify(value)).join("\n");

test("launcher tasks and agents' connections, grouped and newest first; the person's own calls and steps already in a task left out", () => {
  const tasks = lines(
    {
      v: 1,
      task: "ask-1.1",
      time: 100,
      agent: "Claude",
      request: "dark mode and hide the dock",
      steps: [
        {
          title: "Turn Dark Mode on",
          outcome: "done",
          undo: { address: "dashi://tool/set-setting", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" },
        },
        { title: "Hide the Dock automatically", outcome: "done" },
      ],
    },
    { v: 1, task: "ask-1.1", time: 300, undone: 0 },
    "not json",
  );
  const activity = [
    lines(
      { time: 50, agent: "you", claims: null, tool: "dashi://settings/appearance/dark-mode", outcome: "ok" },
      { time: 60, agent: "claude", claims: "claude-code", tool: "list_windows", outcome: "ok" },
      { time: 61, agent: "claude", claims: "claude-code", tool: "screenshot", outcome: "ok" },
      { time: 62, agent: "claude", claims: "claude-code", tool: "list_windows", outcome: "ok" },
      { time: 70, agent: "claude", claims: null, tool: null, outcome: "disconnected" },
      { time: 101, agent: "Claude", claims: null, tool: "dashi://tool/set-setting", outcome: "ok", task: "ask-1" },
      { time: 200, agent: "codex", claims: null, tool: "list_apps", outcome: "ok" },
    ),
    "{broken",
  ].join("\n");
  const entries = readHistory({ tasks, activity });
  expect(entries.map((entry) => [entry.id, entry.who, entry.summary])).toEqual([
    ["session:2", "codex", "1 call: list apps"],
    ["ask-1.1", "Claude", "Turn Dark Mode on, Hide the Dock automatically"],
    ["session:1", "claude", "3 calls: list windows, screenshot"],
  ]);
  expect(entries[0]?.open).toBe(true);
  expect(entries[2]?.open).toBe(false);
  expect(entries[1]?.steps[0]?.undone).toBe(true);
  expect(entries[1]?.request).toBe("dark mode and hide the dock");
});

test("a later line for the same plan replaces the earlier one", () => {
  const tasks = lines(
    { v: 1, task: "ask-2.1", time: 10, agent: "Claude", request: "lock", steps: [{ title: "Lock the screen", outcome: "not-allowed" }] },
    { v: 1, task: "ask-2.1", time: 10, agent: "Claude", request: "lock", steps: [{ title: "Lock the screen", outcome: "done" }] },
  );
  const [entry] = readHistory({ tasks, activity: "" });
  expect(entry?.steps[0]?.outcome).toBe("done");
  expect(
    taskSummary([
      { title: "a", outcome: "done" },
      { title: "b", outcome: "failed" },
    ]),
  ).toBe("1 of 2 done");
});

test("ago, in words", () => {
  expect(ago(1000, 1010)).toBe("just now");
  expect(ago(1000, 1000 + 5 * 60)).toBe("5 min ago");
  expect(ago(0, 3 * 3600)).toBe("3 h ago");
  expect(ago(0, 86_400 + 10)).toBe("yesterday");
  expect(ago(0, 4 * 86_400)).toBe("4 days ago");
});

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

test("the log on disk: written as tasks finish, read back, listeners told", () => {
  dir = mkdtempSync(join(tmpdir(), "dashi-history-"));
  writeFileSync(join(dir, "activity.jsonl"), `${JSON.stringify({ time: 5, agent: "codex", claims: null, tool: "list_apps", outcome: "ok" })}\n`);
  const log = new HistoryLog(dir);
  let heard = 0;
  log.subscribe(() => heard++);
  log.add({ task: "ask-9.1", time: 9, agent: "Local model", request: "lock", steps: [{ title: "Lock the screen", outcome: "done" }] });
  log.undone("ask-9.1", 0);
  expect(heard).toBe(2);
  expect(readFileSync(join(dir, "tasks.jsonl"), "utf8").split("\n").filter(Boolean)).toHaveLength(2);
  expect(log.read().map((entry) => entry.id)).toEqual(["ask-9.1", "session:1"]);
});

test("an agent connecting once per call is one row: its calls counted, their span, each connection kept", () => {
  const call = (time: number, tool: string, agent = "Remote agent") => ({ time, agent, claims: null, tool, outcome: "ok" });
  const end = (time: number) => ({ time, agent: "Remote agent", claims: null, tool: null, outcome: "disconnected" });
  const activity = lines(
    call(1000, "screenshot"),
    end(1001),
    call(1030, "click"),
    end(1031),
    call(1300, "type_text"),
    end(1301),
    // More than ten minutes after the last call: a row of its own.
    call(2000, "screenshot"),
    end(2001),
    // Another agent in between breaks the run.
    call(2100, "list_windows", "claude"),
    call(2200, "screenshot"),
  );
  const entries = readHistory({ tasks: "", activity });
  expect(entries.map((entry) => [entry.id, entry.who, entry.summary, entry.parts?.length ?? 1, entry.open])).toEqual([
    ["session:6", "Remote agent", "1 call: screenshot", 1, true],
    ["session:5", "claude", "1 call: list windows", 1, true],
    ["session:4", "Remote agent", "1 call: screenshot", 1, false],
    ["session:1+", "Remote agent", "3 calls over 5 min: screenshot, click, type text", 3, false],
  ]);
  expect(entries[3]?.parts?.map((part) => [part.id, part.summary])).toEqual([
    ["session:1", "1 call: screenshot"],
    ["session:2", "1 call: click"],
    ["session:3", "1 call: type text"],
  ]);
  expect(entries[3]?.time).toBe(1000);
  expect(entries[3]?.end).toBe(1300);
});

test("a span in words, and the calls' line", () => {
  expect(spanWords(59)).toBeNull();
  expect(spanWords(4 * 60 + 20)).toBe("4 min");
  expect(spanWords(3600)).toBe("1 h");
  expect(spanWords(2 * 3600 + 5 * 60)).toBe("2 h 5 min");
  expect(callsSummary(["screenshot", "click", "screenshot", "type text", "scroll"], 0, 125)).toBe("5 calls over 2 min: screenshot, click, type text");
  expect(groupSessions([])).toEqual([]);
});
