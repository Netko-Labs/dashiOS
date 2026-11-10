import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessOfStream, parseRecord, requestOfPrompt, runningUnits, unitParts } from "../src/agents/handoff/lib/records.ts";
import { readStream, systemdRunner } from "../src/agents/handoff/lib/runner.ts";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "fixtures", "handoff", name)).text();

const RECORD = {
  v: 1,
  id: "abcd1234",
  request: "Book a spinning class",
  harness: "codex",
  started: 1_800_000_000_000,
  turn: 2,
  unit: "dashi-task-abcd1234-2.service",
  log: "/run/user/1000/dashi-agents/abcd1234/turn-2.jsonl",
  messages: [{ text: "the 7:30 one", at: 1_800_000_060_000 }],
  window: 3,
  sites: ["bodytech.com.co"],
  undos: [{ undo: { address: "dashi://tool/set-setting", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" }, undone: false }],
  stopped: null,
  told: 1,
};

describe("a run's record", () => {
  test("parses as it was written", () => {
    expect(parseRecord(JSON.stringify(RECORD))).toEqual(RECORD as never);
  });

  test("a file is untrusted: anything that isn't a record is none, a bad part is left out", () => {
    expect(parseRecord("not json")).toBeNull();
    expect(parseRecord(JSON.stringify({ ...RECORD, v: 2 }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...RECORD, id: "../../etc" }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...RECORD, harness: "rm -rf" }))).toBeNull();
    expect(parseRecord(JSON.stringify({ ...RECORD, turn: 0 }))).toBeNull();
    const odd = parseRecord(JSON.stringify({ ...RECORD, window: "w3", sites: ["a.com", 4], messages: [{ text: 1 }], undos: [{ undo: {} }] }));
    expect(odd).toMatchObject({ window: null, sites: ["a.com"], messages: [], undos: [] });
  });
});

describe("what a shell that starts finds", () => {
  test("the tasks' units still running, each run's newest turn", () => {
    const listed = [
      "dashi-task-abcd1234-1.service loaded inactive dead Dashi agent task abcd1234",
      "dashi-task-abcd1234-2.service loaded active running Dashi agent task abcd1234",
      "dashi-task-efgh5678-1.service loaded activating start Dashi agent task efgh5678",
      "dashi-agent-task-abcd1234-9.scope loaded active running dashi-agent",
      "dashi-task-x-1.service loaded active running nothing of Dashi's",
      "",
    ].join("\n");
    expect(runningUnits(listed)).toEqual(
      new Map([
        ["abcd1234", 2],
        ["efgh5678", 1],
      ]),
    );
    expect(unitParts("dashi-task-abcd1234-12.service")).toEqual({ run: "abcd1234", turn: 12 });
    expect(unitParts("dashi-task-abcd1234-1.scope")).toBeNull();
  });

  test("which harness wrote a stream, by whose events it holds", async () => {
    expect(harnessOfStream(await fixture("claude-code.jsonl"))).toBe("claude-code");
    expect(harnessOfStream(await fixture("codex.jsonl"))).toBe("codex");
    expect(harnessOfStream(await fixture("opencode.jsonl"))).toBe("opencode");
    expect(harnessOfStream('{"dashi":"start","pid":4}\n')).toBeNull();
  });

  test("the request is the prompt's first paragraph, the context after it left out", () => {
    expect(requestOfPrompt("Book a class\n\nThe person was in Helium (window w3).")).toBe("Book a class");
  });

  test("a stream read whole: its lines up to its exit line", () => {
    expect(readStream('{"dashi":"start","pid":4}\n{"a":1}\n\n{"dashi":"exit","code":143}\n')).toEqual({
      lines: ['{"dashi":"start","pid":4}', '{"a":1}'],
      exit: { code: 143 },
    });
    expect(readStream('{"a":1}\n{"b":').exit).toBeUndefined();
  });

  test("the runs' folders, with their records, kept and read back", () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-runs-"));
    const runner = systemdRunner({
      runtime,
      bun: "/usr/bin/bun",
      task: "/x/dashi-task.ts",
      listUnits: () => "dashi-task-abcd1234-2.service loaded active running Dashi agent task abcd1234\n",
    });
    const dir = join(runtime, "dashi-agents", "abcd1234");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "turn-1.prompt"), "Book a spinning class\n\nContext");
    writeFileSync(join(dir, "turn-1.jsonl"), '{"type":"thread.started","thread_id":"t"}\n{"dashi":"exit","code":0}\n');
    writeFileSync(join(dir, "turn-2.jsonl"), "");
    // Not a run's folder.
    mkdirSync(join(runtime, "dashi-agents", "..hidden"), { recursive: true });
    runner.save(parseRecord(JSON.stringify(RECORD)) as never);
    const { runs, running } = runner.found();
    expect(running).toEqual(new Map([["abcd1234", 2]]));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: "abcd1234", turn: 2, prompt: "Book a spinning class\n\nContext" });
    expect(runs[0]?.record).toEqual(RECORD as never);
    expect(runner.readTurn("abcd1234", 1)).toMatchObject({ lines: ['{"type":"thread.started","thread_id":"t"}'], exit: { code: 0 } });
    expect(runner.readTurn("abcd1234", 3)).toBeNull();
    runner.forget("abcd1234");
    expect(runner.found().runs).toEqual([]);
  });
});
