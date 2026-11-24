/**
 * How Dashi runs OpenCode (ask/harness/opencode.ts; decisions.md D691):
 * one command line for plan mode, the assistant and a hand-off, by the
 * version the program says it is. OpenCode 2 runs a private server inside
 * the sandbox (--standalone) and archives Dashi's turns (--archived); 1.x
 * has neither flag and runs as it always did.
 */

import { describe, expect, test } from "bun:test";
import { HARNESSES, harnessAnswerer, opencodeCommand, opencodeFlags, type Probe, programVersion, turnVersion } from "../src/agents/ask/harness/index.ts";
import { majorVersion, versionWords } from "../src/agents/ask/harness/version.ts";
import { askHarness, type Spawner } from "../src/agents/assistant/lib/harness.ts";
import { GrantsMemory } from "../src/agents/handoff/grants.ts";
import type { TaskRunner, TurnStart } from "../src/agents/handoff/lib/runner.ts";
import { startHandoff } from "../src/agents/handoff/service.ts";
import { TOOLS } from "./support/agents-ask-harness.ts";

const V1 = "1.19.6";
const V2 = "opencode v2.4.1";
const OPENCODE = "/home/alexk/.opencode/bin/opencode";
const files = { isExecutable: (path: string) => path === OPENCODE, real: (path: string) => path, exists: () => false, head: () => null };
const env = { HOME: "/home/alexk", XDG_RUNTIME_DIR: "/run/user/1000", PATH: "/usr/bin" };
const shell = { bun: "/usr/bin/bun", bridge: "/dashi/bin/dashi-mcp.ts", dashiAgent: "/dashi/bin/dashi-agent.ts" };

/** A probe that answers `--version` with `said`, and counts how often it was asked. */
function versionProbe(said: string | null) {
  const asked: string[][] = [];
  const probe: Probe = async (argv) => {
    asked.push([...argv]);
    return said === null ? { stdout: "", code: null } : { stdout: `${said}\n`, code: 0 };
  };
  return { probe, asked };
}

const turn = { prompt: "dark mode", system: "Be Dashi.", session: null, mcp: { command: "/usr/bin/bun", args: ["/b/dashi-mcp.ts"], env: {} } };

describe("its version", () => {
  test("read from what the program prints, and its first number", () => {
    expect(versionWords("opencode v2.4.1\n")).toBe("2.4.1");
    expect(versionWords("1.19.6")).toBe("1.19.6");
    expect(versionWords("2.0.0-beta.3")).toBe("2.0.0-beta.3");
    expect(versionWords("opencode")).toBeNull();
    expect(majorVersion("2.4.1")).toBe(2);
    expect(majorVersion("1.19.6")).toBe(1);
    expect(majorVersion(null)).toBeNull();
  });

  test("asked once per file: again when the file changes, and again after no answer", async () => {
    let file = "a";
    const { probe, asked } = versionProbe(V2);
    const path = "/test/opencode-cache";
    expect(await programVersion(path, probe, () => file)).toBe("2.4.1");
    expect(await programVersion(path, probe, () => file)).toBe("2.4.1");
    expect(asked).toEqual([[path, "--version"]]);
    file = "b";
    await programVersion(path, probe, () => file);
    expect(asked).toHaveLength(2);
    const silent = versionProbe(null);
    expect(await programVersion("/test/opencode-silent", silent.probe, () => "x")).toBeNull();
    expect(await programVersion("/test/opencode-silent", silent.probe, () => "x")).toBeNull();
    expect(silent.asked).toHaveLength(2);
  });

  test("only a harness whose command line depends on it is asked", async () => {
    const { probe, asked } = versionProbe(V2);
    expect(await turnVersion(HARNESSES["claude-code"], { program: "/x/claude" }, probe)).toBeNull();
    expect(asked).toEqual([]);
    expect(await turnVersion(HARNESSES.opencode, { program: "/x/opencode-only" }, probe)).toBe("2.4.1");
  });
});

describe("the one command line", () => {
  test("2.x: a private server and an archived session; 1.x: as before; unknown: the current release's", () => {
    expect(opencodeFlags("2.4.1")).toEqual(["--standalone", "--archived"]);
    expect(opencodeFlags("1.19.6")).toEqual([]);
    expect(opencodeFlags(null)).toEqual(["--standalone", "--archived"]);
    const agent = { name: "dashi-task", description: "Works" };
    expect(opencodeCommand({ ...turn, version: "2.4.1", model: "opencode/deepseek-v4.1-flash-free", session: "ses_1" }, agent).args).toEqual([
      "run",
      "--standalone",
      "--archived",
      "--format",
      "json",
      "--agent",
      "dashi-task",
      "--model",
      "opencode/deepseek-v4.1-flash-free",
      "--session",
      "ses_1",
      "--",
      "dark mode",
    ]);
    expect(opencodeCommand({ ...turn, version: "1.19.6" }, agent).args).toEqual(["run", "--format", "json", "--agent", "dashi-task", "--", "dark mode"]);
  });

  test("its install line is the one opencode.ai gives for the current release", () => {
    expect(HARNESSES.opencode.install).toBe("curl -fsSL https://opencode.ai/v2/install | bash");
  });
});

describe("every path runs it by its version", () => {
  test("plan mode", async () => {
    for (const [said, standalone] of [
      [V2, true],
      [V1, false],
    ] as const) {
      const argvs: string[][] = [];
      const answer = harnessAnswerer({
        spec: HARNESSES.opencode,
        find: () => ({ path: OPENCODE, program: `${OPENCODE}-plan-${said}`, readOnly: [] }),
        run: (argv) => {
          argvs.push([...argv]);
          return { pid: 7, stdout: Promise.resolve(""), exited: Promise.resolve(0), stop: () => {} };
        },
        serve: (path) => ({ path, close: () => {} }),
        shell,
        env,
        fromTurn: () => true,
        probe: versionProbe(said).probe,
      });
      await answer.turn([], { text: "dark mode", results: [] }, TOOLS, new AbortController().signal);
      const argv = argvs[0] ?? [];
      expect(argv.slice(0, 5)).toEqual([shell.bun, shell.dashiAgent, "--name", "plan-opencode", "--"]);
      expect(argv.includes("--standalone")).toBe(standalone);
      expect(argv.includes("--archived")).toBe(standalone);
      expect(argv).toContain("dashi-plan");
    }
  });

  test("the assistant", async () => {
    for (const [said, standalone] of [
      [V2, true],
      [V1, false],
    ] as const) {
      const argvs: string[][] = [];
      const spawn: Spawner = (argv) => {
        argvs.push([...argv]);
        return { pid: 8, lines: async () => {}, exited: Promise.resolve({ code: 0, errors: "" }), stop: () => {} };
      };
      const end = await askHarness(
        { env, shell, files: { ...files, real: (path: string) => `${path}-assistant-${said}` }, spawn, probe: versionProbe(said).probe },
        {
          harness: "opencode",
          task: "talk000001",
          prompt: "turn on dark mode",
          system: "Be Dashi.",
          session: null,
          signal: new AbortController().signal,
          say: () => {},
        },
      );
      expect(end.missing).toBe(false);
      const argv = argvs[0] ?? [];
      expect(argv.slice(0, 6)).toEqual([shell.bun, shell.dashiAgent, "--name", "task-talk000001", "--", `${OPENCODE}-assistant-${said}`]);
      expect(argv.includes("--standalone")).toBe(standalone);
      expect(argv.includes("--archived")).toBe(standalone);
    }
  });

  test("a hand-off", async () => {
    for (const [said, standalone] of [
      [V2, true],
      [V1, false],
    ] as const) {
      const started: TurnStart[] = [];
      const runner: TaskRunner = {
        start: async (start) => void started.push(start) ?? null,
        stop: () => {},
        watch: () => () => {},
        forget: () => {},
        save: () => {},
        readTurn: () => null,
        found: () => ({ runs: [], running: new Map() }),
      };
      const handoff = startHandoff({
        settings: { getSnapshot: () => ({ data: { agents: {} } }), subscribe: () => () => {} },
        env,
        runner,
        files: { ...files, real: (path: string) => `${path}-handoff-${said}` },
        probe: versionProbe(said).probe,
        shell: { ...shell, task: "/dashi/bin/dashi-task.ts" },
        memory: new GrantsMemory(null),
        newId: () => "run1",
      });
      await handoff.start({ harness: "opencode", request: "Book a class", context: { window: null, selection: null } });
      const argv = started[0]?.argv ?? [];
      expect(argv[5]).toBe(`${OPENCODE}-handoff-${said}`);
      expect(argv.includes("--standalone")).toBe(standalone);
      expect(argv.includes("--archived")).toBe(standalone);
      expect(argv).toContain("dashi-task");
      handoff.close();
    }
  });
});
