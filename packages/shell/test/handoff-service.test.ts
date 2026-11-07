import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Files } from "../src/agents/ask/harness/index.ts";
import { TASK_PROMPT, taskCommand } from "../src/agents/handoff/commands.ts";
import { contextPrompt, GrantsMemory, grantsKind, NO_CONTEXT, type TaskContext, taskGrants } from "../src/agents/handoff/grants.ts";
import { harnessOrder } from "../src/agents/handoff/order.ts";
import { exitLine, serviceArgs, type TaskRunner, type TurnStart } from "../src/agents/handoff/runner.ts";
import { startHandoff } from "../src/agents/handoff/service.ts";
import { taskOfCgroup } from "../src/agents/sandbox.ts";

const helium: TaskContext = {
  window: { id: 3, app: "Helium", title: "Clases · Bodytech", site: "bodytech.com.co", url: "https://bodytech.com.co/clases" },
  selection: null,
};

describe("the grants card", () => {
  test("its lines are the sandbox's limits; struck through what it can't", () => {
    expect(taskGrants(helium).map((line) => [line.words, line.allowed])).toEqual([
      ["Websites: asks per site", true],
      ["Your logins: asks each time", true],
      ["Payments: asks each time", true],
      ["Sees: Helium · bodytech.com.co", true],
      ["Your files", false],
      ["Other windows", false],
    ]);
    expect(taskGrants({ window: null, selection: "some words" }).map((line) => line.words)).toContain("Sees: your selection");
  });

  test("a kind is the same grants, whatever the site", () => {
    const other = { ...helium, window: { ...helium.window, site: "example.com" } } as TaskContext;
    expect(grantsKind(taskGrants(helium))).toBe(grantsKind(taskGrants(other)));
    expect(grantsKind(taskGrants(helium))).not.toBe(grantsKind(taskGrants(NO_CONTEXT)));
    expect(grantsKind(taskGrants(NO_CONTEXT))).toBe("logins+pay+web");
  });

  test("shown once per kind, kept across sessions; never with Don't ask for these again", () => {
    const path = join(mkdtempSync(join(tmpdir(), "handoff-")), "handoff.json");
    const memory = new GrantsMemory(path);
    const kind = grantsKind(taskGrants(helium));
    expect(memory.needsCard(kind, false)).toBe(true);
    expect(memory.needsCard(kind, true)).toBe(false);
    memory.remember(kind);
    expect(memory.needsCard(kind, false)).toBe(false);
    expect(new GrantsMemory(path).needsCard(kind, false)).toBe(false);
    expect(new GrantsMemory(path).needsCard("logins+pay+web", false)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ seen: [kind] });
    memory.forget();
    expect(new GrantsMemory(path).needsCard(kind, false)).toBe(true);
  });

  test("what the harness is told of the context chips", () => {
    expect(contextPrompt(helium)).toContain("window w3, showing https://bodytech.com.co/clases");
    expect(contextPrompt(helium)).toContain("hand_over");
    // Ask's plan only reads the window: no hand-over offered.
    expect(contextPrompt(helium, false)).not.toContain("hand_over");
    expect(contextPrompt(NO_CONTEXT)).toBe("");
    expect(contextPrompt({ window: null, selection: "Thursday 7am" })).toContain('"""\nThursday 7am\n"""');
  });
});

describe("the harnesses' command lines for a task", () => {
  const turn = { prompt: "Book it", system: TASK_PROMPT, session: null, mcp: { command: "/usr/bin/bun", args: ["/x/dashi-mcp.ts"], env: {} } };

  test("Claude Code: stream-json, its own tools off, only Dashi's server", () => {
    const command = taskCommand("claude-code", turn);
    expect(command.args.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(command.args).toContain("--strict-mcp-config");
    expect(command.args[command.args.indexOf("--tools") + 1]).toBe("");
    expect(command.args[command.args.indexOf("--allowedTools") + 1]).toBe("mcp__dashi");
    expect(JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1] ?? "{}")).toEqual({
      mcpServers: { dashi: { type: "stdio", command: "/usr/bin/bun", args: ["/x/dashi-mcp.ts"], env: {} } },
    });
    expect(command.stdin).toBe("Book it");
    expect(command.args).not.toContain("--resume");
    expect(taskCommand("claude-code", { ...turn, session: "s-1" }).args.slice(-2)).toEqual(["--resume", "s-1"]);
  });

  test("Codex: exec --json, resumed by its thread", () => {
    const command = taskCommand("codex", { ...turn, session: "th-1" });
    expect(command.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(command.args.slice(-3)).toEqual(["resume", "th-1", "-"]);
    expect(command.stdin.startsWith(TASK_PROMPT)).toBe(true);
  });

  test("OpenCode: run --format json, its config inline", () => {
    const command = taskCommand("opencode", { ...turn, session: "ses_1" });
    expect(command.args).toEqual(["run", "--format", "json", "--agent", "dashi-task", "--session", "ses_1", "--", "Book it"]);
    expect(JSON.parse(command.env.OPENCODE_CONFIG_CONTENT ?? "{}").tools).toEqual({ "*": false, "dashi_*": true });
  });

  test("the one to hand off to first: Settings' choice, else the answerer, else the catalog's order", () => {
    expect(harnessOrder(["claude-code", "codex"], "codex", "claude-code")).toEqual(["codex", "claude-code"]);
    expect(harnessOrder(["claude-code", "codex"], "opencode", "codex")).toEqual(["codex", "claude-code"]);
    expect(harnessOrder(["claude-code", "codex"], undefined, "gpt")).toEqual(["claude-code", "codex"]);
    expect(harnessOrder([], "codex", "codex")).toEqual([]);
  });
});

describe("running a turn as a user service", () => {
  test("systemd-run's arguments: a transient unit, the environment, dashi-task, then the command", () => {
    const start: TurnStart = {
      run: "abc123",
      turn: 2,
      argv: ["/bun", "/dashi-agent.ts", "--name", "task-abc123", "--", "/claude", "-p"],
      stdin: "",
      env: { HOME: "/home/alex" },
    };
    expect(serviceArgs("dashi-task-abc123-2.service", "/dashi-task.ts", start, { stream: "/s", prompt: "/p" }, "/bun")).toEqual([
      "systemd-run",
      "--user",
      "--quiet",
      "--collect",
      "--unit=dashi-task-abc123-2.service",
      "--description=Dashi agent task abc123",
      "--setenv=HOME=/home/alex",
      "--",
      "/bun",
      "/dashi-task.ts",
      "--log",
      "/s",
      "--prompt",
      "/p",
      "--",
      "/bun",
      "/dashi-agent.ts",
      "--name",
      "task-abc123",
      "--",
      "/claude",
      "-p",
    ]);
  });

  test("dashi-task's last line", () => {
    expect(exitLine('{"dashi":"exit","code":0}')).toEqual({ code: 0 });
    expect(exitLine('{"dashi":"exit","code":null}')).toEqual({ code: null });
    expect(exitLine('{"dashi":"start","pid":4}')).toBeNull();
    expect(exitLine('{"type":"result"}')).toBeNull();
  });

  test("a connection's task, from its sandbox's scope", () => {
    expect(taskOfCgroup("0::/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-task-ab12cd34ef-4411.scope\n")).toBe("ab12cd34ef");
    expect(taskOfCgroup("0::/user.slice/user@1000.service/app.slice/dashi-agent-claude-4411.scope\n")).toBeNull();
    expect(taskOfCgroup("0::/user.slice/dashi-agent-task-AB!-1.scope\n")).toBeNull();
  });
});

/** A runner that records what it was asked and plays lines into the watchers. */
function fakeRunner() {
  const started: TurnStart[] = [];
  const stopped: string[] = [];
  const watchers = new Map<string, { line: (line: string) => void; exit: (code: number | null) => void }>();
  const runner: TaskRunner = {
    async start(turn) {
      started.push(turn);
      return null;
    },
    stop(run, turn) {
      stopped.push(`${run}:${turn}`);
    },
    watch(run, turn, line, exit) {
      watchers.set(`${run}:${turn}`, { line, exit });
      return () => watchers.delete(`${run}:${turn}`);
    },
    forget() {},
  };
  return { runner, started, stopped, watchers };
}

const files: Files = {
  isExecutable: (path) => path === "/home/alex/.local/bin/claude",
  real: (path) => path,
  exists: () => false,
  head: () => null,
};

function service() {
  const fake = fakeRunner();
  let id = 0;
  const handoff = startHandoff({
    settings: { getSnapshot: () => ({ data: { agents: {} } }), subscribe: () => () => {} },
    env: { HOME: "/home/alex", XDG_RUNTIME_DIR: "/run/user/1000", PATH: "/usr/bin" },
    runner: fake.runner,
    files,
    shell: { bun: "/usr/bin/bun", bridge: "/dashi/bin/dashi-mcp.ts", dashiAgent: "/dashi/bin/dashi-agent.ts", task: "/dashi/bin/dashi-task.ts" },
    memory: new GrantsMemory(null),
    settingNow: (name) => (name === "dark_mode" ? false : undefined),
    setSettingAddress: () => "dashi://settings/set",
    newId: () => `run${++id}`,
  });
  return { handoff, ...fake };
}

const line = (value: unknown) => JSON.stringify(value);

describe("the hand-off service", () => {
  test("only installed harnesses have a row", () => {
    const { handoff } = service();
    expect(handoff.harnesses().map((harness) => harness.id)).toEqual(["claude-code"]);
    handoff.close();
  });

  test("a start runs dashi-agent with a task profile and the words, and reads its stream", async () => {
    const { handoff, started, watchers } = service();
    const id = await handoff.start({ harness: "claude-code", request: "Book a class", context: helium });
    expect(id).toBe("run1");
    const turn = started[0];
    expect(turn?.argv.slice(0, 5)).toEqual(["/usr/bin/bun", "/dashi/bin/dashi-agent.ts", "--name", "task-run1", "--"]);
    expect(turn?.argv[5]).toBe("/home/alex/.local/bin/claude");
    expect(turn?.stdin).toContain("Book a class");
    expect(turn?.stdin).toContain("window w3");
    const profile = JSON.parse(turn?.env.DASHI_AGENT_PLAN ?? "{}");
    expect(profile).toMatchObject({ socket: "/run/user/1000/dashi-mcp.sock", task: true });
    expect(profile.state).toEqual(["/home/alex/.claude", "/home/alex/.claude.json"]);
    // No key of the session reaches it.
    expect(Object.keys(turn?.env ?? {})).not.toContain("ANTHROPIC_API_KEY");
    // Its connection's policy: the card's grants, the rest refused, the context window handed over.
    expect(handoff.policy("run1")).toEqual({ granted: ["web", "signin", "pay"], refused: ["see", "screen", "act", "files", "clipboard"], window: 3 });
    expect(handoff.policy("nobody")).toBeNull();

    const watcher = watchers.get("run1:1");
    watcher?.line(line({ type: "system", subtype: "init", session_id: "s-1" }));
    watcher?.line(
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t1", name: "mcp__dashi__open_url", input: { url: "https://bodytech.com.co" } }] },
      }),
    );
    expect(handoff.runs.get("run1")?.steps.map((step) => step.words)).toEqual(["Opening bodytech.com.co"]);
    watcher?.line(line({ type: "result", subtype: "success", is_error: false, result: "Booked it", session_id: "s-1" }));
    watcher?.exit(0);
    expect(handoff.runs.get("run1")?.phase).toBe("done");
    expect(handoff.runs.get("run1")?.summary).toBe("Booked it");
    handoff.close();
  });

  test("words to a working run: it is stopped, then resumed with them in its session", async () => {
    const { handoff, started, stopped, watchers } = service();
    await handoff.start({ harness: "claude-code", request: "Book a class", context: NO_CONTEXT });
    watchers.get("run1:1")?.line(line({ type: "system", subtype: "init", session_id: "s-1" }));
    expect(handoff.tell("run1", "use the 7:30 one if 7 is full")).toBe(true);
    expect(stopped).toEqual(["run1:1"]);
    // Its turn ends (stopped): the next one starts, resuming the session; the stop isn't "stopped".
    watchers.get("run1:1")?.exit(143);
    await Bun.sleep(0);
    expect(started).toHaveLength(2);
    expect(started[1]?.turn).toBe(2);
    expect(started[1]?.argv.slice(-2)).toEqual(["--resume", "s-1"]);
    expect(started[1]?.stdin).toContain("use the 7:30 one if 7 is full");
    expect(handoff.runs.get("run1")?.phase).toBe("starting");
    expect(handoff.runs.get("run1")?.turn).toBe(2);
    handoff.close();
  });

  test("words to a finished run resume it; to one still starting, they wait for its session", async () => {
    const { handoff, started, stopped, watchers } = service();
    await handoff.start({ harness: "claude-code", request: "Book", context: NO_CONTEXT });
    handoff.tell("run1", "at 7:30");
    expect(stopped).toEqual([]);
    watchers.get("run1:1")?.line(line({ type: "system", subtype: "init", session_id: "s-1" }));
    expect(stopped).toEqual(["run1:1"]);
    watchers.get("run1:1")?.exit(143);
    await Bun.sleep(0);
    watchers.get("run1:2")?.line(line({ type: "result", subtype: "success", result: "ok", session_id: "s-1" }));
    watchers.get("run1:2")?.exit(0);
    expect(handoff.runs.get("run1")?.phase).toBe("done");
    handoff.tell("run1", "and add it to my calendar");
    await Bun.sleep(0);
    expect(started.map((each) => each.turn)).toEqual([1, 2, 3]);
    expect(started[2]?.stdin).toContain("follows up");
    handoff.close();
  });

  test("Stop stops its unit, and its end reads 'stopped'", async () => {
    const { handoff, stopped, watchers } = service();
    await handoff.start({ harness: "claude-code", request: "Book", context: NO_CONTEXT });
    watchers.get("run1:1")?.line(line({ type: "system", subtype: "init", session_id: "s-1" }));
    handoff.stop("run1");
    expect(stopped).toEqual(["run1:1"]);
    watchers.get("run1:1")?.exit(143);
    expect(handoff.runs.get("run1")?.phase).toBe("stopped");
    handoff.close();
  });

  test("a settings change it made can be put back", async () => {
    const { handoff } = service();
    await handoff.start({ harness: "claude-code", request: "Dark mode please", context: NO_CONTEXT });
    const undo = handoff.before("run1", { name: "set_setting", setting: "dark_mode", value: true });
    expect(undo).toEqual({ address: "dashi://settings/set", args: { name: "dark_mode", value: false }, title: expect.any(String) });
    handoff.after("run1", undo, true);
    expect(handoff.runs.get("run1")?.undos).toHaveLength(1);
    // No change, nothing to put back; another agent's calls aren't a run's.
    expect(handoff.before("run1", { name: "set_setting", setting: "dark_mode", value: false })).toBeNull();
    expect(handoff.before("someone", { name: "set_setting", setting: "dark_mode", value: true })).toBeNull();
    handoff.close();
  });

  test("a harness not installed: the run fails at once and says so", async () => {
    const { handoff, started } = service();
    await handoff.start({ harness: "codex", request: "Book", context: NO_CONTEXT });
    expect(started).toEqual([]);
    expect(handoff.runs.get("run1")?.phase).toBe("failed");
    expect(handoff.runs.get("run1")?.error).toBe("Codex isn't installed.");
    handoff.close();
  });
});
