import { describe, expect, test } from "bun:test";
import { type Exec, exec } from "../apps/files/exec.ts";
import { OPEN_TIMEOUT_MS, openDefault, openWithDefault } from "../apps/files/open.ts";
import { runTool } from "../apps/preview/tools.ts";

// `gio open` exits once the app has the file, but the app it started holds gio's
// stdout and stderr: reading them to their end waited for the app to quit, so the
// agent's open_file never returned. A shell that leaves a child behind is the same.
const LAUNCHER = ["sh", "-c", "echo opening >&2; sleep 3 & exit 0"];

describe("a launcher whose app keeps its pipes", () => {
  test("exec is done when it exits, with what it wrote by then", async () => {
    const started = performance.now();
    const outcome = await exec(LAUNCHER, { untilExit: true });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(outcome).toMatchObject({ ok: true, code: 0, stderr: "opening\n" });
  });

  test("its failure and its words still come back", async () => {
    const outcome = await exec(["sh", "-c", "echo 'no app for that' >&2; sleep 3 & exit 4"], { untilExit: true });
    expect(outcome).toMatchObject({ ok: false, code: 4, stderr: "no app for that\n" });
  });

  test("a launcher that never finishes is given up on, and says so", async () => {
    const outcome = await exec(["sleep", "3"], { untilExit: true, timeoutMs: 100 });
    expect(outcome.timedOut).toBe(true);
    expect(outcome.ok).toBe(false);
  });

  test("Preview's runTool is done when gio launch exits too", async () => {
    const started = performance.now();
    const outcome = await runTool(LAUNCHER, { timeoutMs: 10_000, untilExit: true });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(outcome).toMatchObject({ ok: true, code: 0, timedOut: false });
  });
});

describe("openDefault: what became of the open", () => {
  const answering =
    (result: Awaited<ReturnType<Exec>>, seen: unknown[] = []): Exec =>
    async (command, options) => {
      seen.push({ command, options });
      return result;
    };

  test("gio open is waited for until it exits, for at most the open timeout", async () => {
    const seen: unknown[] = [];
    expect(await openDefault("/home/alexk/notes.txt", answering({ ok: true, code: 0, stdout: "", stderr: "" }, seen))).toEqual({ kind: "opened" });
    expect(seen).toEqual([{ command: ["gio", "open", "--", "/home/alexk/notes.txt"], options: { untilExit: true, timeoutMs: OPEN_TIMEOUT_MS } }]);
  });

  test("a failure says gio's words; a slow app is waiting, not wrong", async () => {
    expect(await openDefault("/home/alexk/a.xyz", answering({ ok: false, code: 2, stdout: "", stderr: "gio: No application is registered\n" }))).toEqual({
      kind: "failed",
      problem: "No application is registered",
    });
    const slow = answering({ ok: false, code: null, stdout: "", stderr: "", timedOut: true });
    expect(await openDefault("/home/alexk/big.pdf", slow)).toEqual({ kind: "waiting" });
    expect(await openWithDefault("/home/alexk/big.pdf", slow)).toBeNull();
  });
});
