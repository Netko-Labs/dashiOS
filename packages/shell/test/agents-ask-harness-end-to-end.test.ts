import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnswerError, type HarnessId } from "../src/agents/ask/answerer.ts";
import { HARNESSES, harnessAnswerer, hostRunner, type Runner } from "../src/agents/ask/harness/index.ts";
import { spokenWords, stepsFrom } from "../src/agents/ask/plan.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { TOOLS } from "./support/agents-ask-harness.ts";

describe("a harness answering, end to end with a fake CLI", () => {
  const fixture = join(import.meta.dir, "fixtures", "fake-harness.ts");
  const bridge = join(import.meta.dir, "..", "bin", "dashi-mcp.ts");

  function answerer(id: HarnessId, runtime: string, timeoutMs?: number) {
    const argvs: string[][] = [];
    const host = hostRunner(() => "none.scope");
    const run: Runner = (argv, options) => {
      argvs.push([...argv]);
      return host([process.execPath, ...argv], options);
    };
    const answer = harnessAnswerer({
      spec: HARNESSES[id],
      find: () => ({ path: fixture, program: fixture, readOnly: [] }),
      run,
      shell: { bun: process.execPath, bridge, dashiAgent: "/nonexistent" },
      env: { HOME: runtime, XDG_RUNTIME_DIR: runtime, PATH: process.env.PATH },
      fromTurn: () => true,
      direct: true,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return { answer, argvs };
  }

  for (const id of ["claude-code", "codex", "opencode"] as const) {
    test(`${id}: its calls through plan mode are the plan, nothing ran, and a follow-up resumes its session`, async () => {
      const runtime = mkdtempSync(join(tmpdir(), "dashi-harness-"));
      const { answer, argvs } = answerer(id, runtime);
      const first = await answer.turn([], { text: "@bad dark mode and open notes", results: [] }, TOOLS, new AbortController().signal);
      expect(first.reply.calls).toEqual([
        expect.objectContaining({ name: "set_setting", input: { name: "dark_mode", value: true } }),
        expect.objectContaining({ name: "launch_app", input: { app: "Notes" } }),
      ]);
      // The bad call was answered with why, and the harness heard each step's number.
      expect(first.reply.text).toContain(`${TOOLS.length} tools | error: Not planned`);
      expect(first.reply.text).toContain("ok: Planned as step 2; nothing runs until the person presses Return.");
      // None of that chatter shows under the plan (the 0.4 VM run showed it whole).
      expect(spokenWords(first.reply.text)).toBe("");
      const steps = stepsFrom(first.reply.calls, TOOL_ACTIONS);
      expect(steps.map((step) => [step.title, step.state.kind])).toEqual([
        ["Turn Dark Mode on", "ready"],
        ["Open “Notes”", "ready"],
      ]);
      const session = (first.history[0] as { session: string }).session;
      expect(session).toStartWith("session-");
      const second = await answer.turn(
        first.history,
        { text: "and lock", results: [{ id: "x", text: "Done.", error: false }] },
        TOOLS,
        new AbortController().signal,
      );
      expect(second.reply.text).toContain(`resumed ${session}`);
      expect(argvs).toHaveLength(2);
      rmSync(runtime, { recursive: true, force: true });
    });
  }

  test("not signed in, too slow, or stopped: a clear failure, and nothing is planned", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-harness-"));
    const { answer } = answerer("claude-code", runtime, 400);
    const failure = (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error: unknown) => (error instanceof AnswerError ? [error.failure, error.message] : String(error)),
      );
    expect(await failure(answer.turn([], { text: "@signed-out", results: [] }, TOOLS, new AbortController().signal))).toEqual([
      "not-signed-in",
      "Claude Code isn't signed in.",
    ]);
    expect(await failure(answer.turn([], { text: "@hang", results: [] }, TOOLS, new AbortController().signal))).toEqual([
      "no-answer",
      "Claude Code took too long.",
    ]);
    const stop = new AbortController();
    const stopped = failure(answer.turn([], { text: "@hang", results: [] }, TOOLS, stop.signal));
    stop.abort();
    expect(await stopped).toContain("AbortError");
    const missing = harnessAnswerer({
      spec: HARNESSES.codex,
      find: () => null,
      run: () => {
        throw new Error("never run");
      },
      shell: { bun: "", bridge: "", dashiAgent: "" },
      env: { HOME: runtime, XDG_RUNTIME_DIR: runtime },
      fromTurn: () => true,
    });
    expect(await failure(missing.turn([], { text: "x", results: [] }, TOOLS, new AbortController().signal))).toEqual([
      "not-installed",
      "Codex isn't installed.",
    ]);
    rmSync(runtime, { recursive: true, force: true });
  });
});
