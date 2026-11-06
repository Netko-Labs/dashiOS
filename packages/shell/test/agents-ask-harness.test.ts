import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWERER_CHOICES, AnswerError, type HarnessId, type PlanTool } from "../src/agents/ask/answerer.ts";
import { answererRows } from "../src/agents/ask/choices.ts";
import { signInCommand } from "../src/agents/ask/harness/catalog.ts";
import {
  type Files,
  findHarness,
  HARNESS_PROMPT,
  HARNESSES,
  harnessAnswerer,
  harnessEnv,
  harnessStatuses,
  hostRunner,
  installReads,
  PlanRecorder,
  parsedArguments,
  plannedWords,
  type Runner,
  servePlan,
  signedIn,
  turnPrompt,
} from "../src/agents/ask/harness/index.ts";
import { planTools, spokenWords, stepsFrom } from "../src/agents/ask/plan.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";
import { agentHandlers } from "../src/launcher/agents/handlers.ts";
import { failureLine } from "../src/launcher/agents/plan-view.tsx";
import { taskSubmit } from "../src/launcher/agents/task-mode.tsx";

const TOOLS = planTools(TOOL_ACTIONS);
const line = (method: string, params: Record<string, unknown> = {}, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });

describe("plan mode", () => {
  test("tools/list is the plan's tools: the same set the Claude API answerer is offered", () => {
    const recorder = new PlanRecorder(TOOLS, "t");
    const init = recorder.handle(line("initialize", { protocolVersion: "2025-06-18" })) as { result: { instructions: string; serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("dashi");
    expect(init.result.instructions).toContain("Nothing runs until the person reads the plan and presses Return");
    expect(recorder.handle(line("notifications/initialized", {}, null))).toBeNull();
    const listed = recorder.handle(line("tools/list")) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain("screenshot");
    expect(listed.result.tools[0]?.inputSchema).toEqual(TOOLS[0]?.schema);
  });

  test("a call is recorded with its parsed arguments and answered, never run", () => {
    const ran: string[] = [];
    // Tools whose check notes it was asked: the recorder checks, and that is all it may do.
    const tools: PlanTool[] = TOOLS.map((tool) => ({
      ...tool,
      check: (args) => {
        ran.push(`check ${tool.name}`);
        return tool.check?.(args) ?? { ok: true };
      },
    }));
    const recorder = new PlanRecorder(tools, "t");
    const reply = recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: true } })) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(reply.result.content[0]?.text).toBe("Planned as step 1; nothing runs until the person presses Return.");
    expect(reply.result.isError).toBeUndefined();
    recorder.handle(line("tools/call", { name: "lock_screen" }, 2));
    expect(recorder.calls).toEqual([
      { id: "t-1", name: "set_setting", input: { name: "dark_mode", value: true } },
      { id: "t-2", name: "lock_screen", input: {} },
    ]);
    expect(ran).toEqual(["check set_setting", "check lock_screen"]);
    expect(plannedWords(2)).toContain("step 2");
  });

  test("a call that doesn't pass, an unknown tool, or one past the last step is answered with why, and not recorded", () => {
    const recorder = new PlanRecorder(TOOLS, "t", 1);
    const bad = recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: "very" } })) as {
      result: { content: Array<{ text: string }>; isError: boolean };
    };
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0]?.text).toContain("Not planned: `value` must be true or false.");
    const unknown = recorder.handle(line("tools/call", { name: "screenshot", arguments: {} })) as { result: { isError: boolean } };
    expect(unknown.result.isError).toBe(true);
    const odd = recorder.handle(line("tools/call", { name: "lock_screen", arguments: [1] })) as { result: { isError: boolean } };
    expect(odd.result.isError).toBe(true);
    recorder.handle(line("tools/call", { name: "lock_screen", arguments: {} }));
    const full = recorder.handle(line("tools/call", { name: "lock_screen", arguments: {} })) as { result: { content: Array<{ text: string }> } };
    expect(full.result.content[0]?.text).toContain("nothing more can be added");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.handle("not json")).toMatchObject({ error: { code: -32700 } });
    expect(recorder.handle(line("resources/list"))).toMatchObject({ error: { code: -32601 } });
  });

  test("arguments some MCP clients send as text are parsed as the schema means them", () => {
    const recorder = new PlanRecorder(TOOLS, "t");
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dark_mode", value: "true" } }));
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "dock_style", value: "taskbar" } }, 2));
    recorder.handle(line("tools/call", { name: "set_setting", arguments: { name: "trackpad_scroll_speed", value: "1.5" } }, 3));
    expect(recorder.calls.map((call) => (call.input as { value: unknown }).value)).toEqual([true, "taskbar", 1.5]);
    const schema = { type: "object", properties: { title: { type: "string" }, n: { type: "integer" } } };
    expect(parsedArguments({ title: "true", n: "x" }, schema)).toEqual({ title: "true", n: "x" });
  });

  test("the socket refuses a process the turn doesn't own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashi-plan-"));
    const seen: Array<number | null> = [];
    const server = servePlan(join(dir, "turn.sock"), new PlanRecorder(TOOLS, "t"), (pid) => {
      seen.push(pid);
      return false;
    });
    const closed = new Promise<boolean>((resolve) => {
      void Bun.connect({
        unix: server.path,
        socket: { data() {}, close: () => resolve(true), open: (socket) => void socket.write(`${line("tools/list")}\n`) },
      });
    });
    expect(await closed).toBe(true);
    expect(seen).toEqual([process.pid]);
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("finding harnesses", () => {
  const home = "/home/alexk";
  const files = (executables: string[], links: Record<string, string> = {}, heads: Record<string, string> = {}, existing: string[] = []): Files => ({
    isExecutable: (path) => executables.includes(path),
    real: (path) => links[path] ?? (executables.includes(path) ? path : null),
    exists: (path) => existing.includes(path),
    head: (path) => heads[path] ?? null,
  });

  test("on PATH first, then where installers put it; links are followed to the program", () => {
    const fs = files(["/home/alexk/.local/bin/claude"], { "/home/alexk/.local/bin/claude": "/home/alexk/.local/share/claude/versions/2.1.317" });
    const found = findHarness(HARNESSES["claude-code"], home, "/usr/bin:/bin", fs);
    expect(found).toEqual({
      path: "/home/alexk/.local/bin/claude",
      program: "/home/alexk/.local/share/claude/versions/2.1.317",
      readOnly: ["/home/alexk/.local/share/claude/versions/2.1.317"],
    });
    expect(findHarness(HARNESSES.codex, home, "/usr/bin", fs)).toBeNull();
    // Installed for everyone: nothing of the home folder to bind.
    expect(findHarness(HARNESSES.codex, home, "/usr/local/bin:/usr/bin", files(["/usr/local/bin/codex"]))?.readOnly).toEqual([]);
  });

  test("a Node script brings its package, and an interpreter under the home folder its install", () => {
    const script = "/home/alexk/.npm-global/lib/node_modules/@openai/codex/bin/codex.js";
    const fs = files(
      ["/home/alexk/.npm-global/bin/codex", "/home/alexk/.nvm/versions/node/v24.1.0/bin/node"],
      { "/home/alexk/.npm-global/bin/codex": script },
      { [script]: "#!/usr/bin/env node\n" },
      ["/home/alexk/.npm-global/lib/node_modules/@openai/codex/package.json"],
    );
    expect(installReads(script, home, "/home/alexk/.nvm/versions/node/v24.1.0/bin:/usr/bin", fs)).toEqual([
      "/home/alexk/.npm-global/lib/node_modules/@openai/codex",
      "/home/alexk/.nvm/versions/node/v24.1.0",
    ]);
  });

  test("signed in: Claude Code's status, Codex's exit code, OpenCode's login file; never a model call", async () => {
    const found = { path: "/usr/bin/x", program: "/usr/bin/x", readOnly: [] };
    const asked: string[][] = [];
    const probe = (stdout: string, code: number | null) => async (argv: readonly string[]) => {
      asked.push([...argv]);
      return { stdout, code };
    };
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe('{"loggedIn": true, "authMethod": "claude.ai"}', 0))).toBe(true);
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe('{"loggedIn": false}', 1))).toBe(false);
    expect(await signedIn(HARNESSES["claude-code"], found, home, {}, probe("garbage", 0))).toBeNull();
    expect(asked[0]).toEqual(["/usr/bin/x", "auth", "status", "--json"]);
    expect(await signedIn(HARNESSES.codex, found, home, {}, probe("Logged in using ChatGPT", 0))).toBe(true);
    expect(await signedIn(HARNESSES.codex, found, home, {}, probe("Not logged in", 1))).toBe(false);
    expect(asked.at(-1)).toEqual(["/usr/bin/x", "login", "status"]);
    const read = (text: string | null) => (path: string) => (path === "/home/alexk/.local/share/opencode/auth.json" ? text : null);
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read('{"anthropic":{"type":"oauth"}}'))).toBe(true);
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read("{}"))).toBeNull();
    expect(await signedIn(HARNESSES.opencode, found, home, {}, probe("", 0), read(null))).toBeNull();
  });

  test("statuses come in the catalog's order, a missing one not installed", async () => {
    const fs = files(["/usr/bin/claude"]);
    const statuses = await harnessStatuses([HARNESSES["claude-code"], HARNESSES.codex, HARNESSES.opencode], { HOME: home, PATH: "/usr/bin" }, fs, async () => ({
      stdout: '{"loggedIn":true}',
      code: 0,
    }));
    expect(statuses).toEqual([
      { id: "claude-code", installed: true, signedIn: true },
      { id: "codex", installed: false, signedIn: null },
      { id: "opencode", installed: false, signedIn: null },
    ]);
  });
});

describe("the rows and their order", () => {
  test("harnesses first, then a local model, the APIs, then none", () => {
    expect(ANSWERER_CHOICES).toEqual(["claude-code", "codex", "opencode", "local", "claude", "gpt", "none"]);
    const rows = answererRows([
      { id: "claude-code", installed: true, signedIn: true },
      { id: "codex", installed: true, signedIn: false },
      { id: "opencode", installed: false, signedIn: null },
    ]);
    expect(rows.map((row) => row.value)).toEqual(["claude-code", "codex", "local", "claude", "gpt", "opencode", "none"]);
    expect(rows[0]?.detail).toBe("Your Claude subscription. Signed in.");
    expect(rows[1]?.detail).toBe("Your ChatGPT plan. Not signed in: run codex login in Terminal.");
    expect(rows.find((row) => row.value === "opencode")).toMatchObject({
      available: false,
      detail: "Not installed. Install it with curl -fsSL https://opencode.ai/install | bash",
    });
    // Chosen before it went: it stays where it was, and can't be picked again.
    expect(answererRows([{ id: "opencode", installed: false, signedIn: null }], "opencode")[2]).toMatchObject({ value: "opencode", available: true });
    expect(answererRows(null)[0]?.detail).toBe("Your Claude subscription. Looking…");
  });

  test("a harness that isn't signed in: Return opens Terminal, with the command to type", () => {
    expect(signInCommand("claude-code")).toBe("claude auth login");
    expect(signInCommand("gpt")).toBeNull();
    expect(failureLine({ kind: "not-signed-in", text: "Claude Code isn't signed in." }, "claude auth login")).toBe(
      "Claude Code isn't signed in. Return opens Terminal to sign in with claude auth login.",
    );
    expect(failureLine({ kind: "not-installed", text: "Codex isn't installed." })).toBe("Codex isn't installed. Return opens Settings.");
    const task = {
      id: "t",
      answerer: { id: "claude-code" as const, name: "Claude Code", where: "" },
      request: "x",
      phase: "failed" as const,
      steps: [],
      said: "",
      failure: { kind: "not-signed-in" as const, text: "" },
    };
    expect(taskSubmit(task, "", null)).toEqual({ kind: "sign-in" });
  });

  test("Esc while a plan is still being asked for stops it; on a plan it only goes back", () => {
    const stopped: string[] = [];
    const handlers = (phase: "asking" | "planned") =>
      agentHandlers({
        agents: { stop: (item: { kind: string; id?: string }) => stopped.push(`${item.kind}:${item.id ?? ""}`) } as never,
        snapshot: null,
        mode: "task",
        task: { id: "t1", answerer: { id: "claude-code", name: "Claude Code", where: "" }, request: "x", phase, steps: [], said: "", failure: null },
        text: "",
        draft: "",
        selectedRow: undefined,
        openTask: () => {},
        clearDraft: () => {},
        editWords: () => {},
        back: () => {},
        close: () => {},
        say: () => {},
        sayDone: () => {},
        offerSetUp: () => {},
      });
    handlers("planned").leave();
    expect(stopped).toEqual([]);
    handlers("asking").leave();
    expect(stopped).toEqual(["task:t1"]);
  });
});

describe("command lines", () => {
  const turn = {
    prompt: "dark mode",
    system: HARNESS_PROMPT,
    session: null,
    mcp: { command: "/usr/bin/bun", args: ["/b/dashi-mcp.ts"], env: { DASHI_MCP_SOCKET: "/run/p.sock" } },
  };

  test("Claude Code: headless, no built-in tools, only Dashi's server, no hooks, the prompt on stdin", () => {
    const { args, stdin } = HARNESSES["claude-code"].command(turn);
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe("-p");
    expect(after("--tools")).toBe("");
    expect(after("--allowedTools")).toBe("mcp__dashi");
    expect(after("--permission-mode")).toBe("dontAsk");
    expect(after("--setting-sources")).toBe("");
    expect(args).toContain("--strict-mcp-config");
    expect(JSON.parse(after("--mcp-config") ?? "")).toEqual({
      mcpServers: { dashi: { type: "stdio", command: "/usr/bin/bun", args: ["/b/dashi-mcp.ts"], env: { DASHI_MCP_SOCKET: "/run/p.sock" } } },
    });
    expect(args).not.toContain("--resume");
    expect(stdin).toBe("dark mode");
    expect(HARNESSES["claude-code"].command({ ...turn, session: "s-1" }).args.slice(-2)).toEqual(["--resume", "s-1"]);
  });

  test("Codex: exec with its shell and web search off, read-only, Dashi's server; OpenCode: every tool off but Dashi's", () => {
    const codex = HARNESSES.codex.command({ ...turn, session: "th-1" });
    expect(codex.args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(codex.args).toEqual(expect.arrayContaining(["features.shell_tool=false", 'web_search="disabled"', "--ignore-user-config", "read-only"]));
    expect(codex.args).toContain('mcp_servers.dashi.env={DASHI_MCP_SOCKET="/run/p.sock"}');
    expect(codex.args.slice(-3)).toEqual(["resume", "th-1", "-"]);
    expect(codex.stdin.startsWith(HARNESS_PROMPT)).toBe(true);
    const opencode = HARNESSES.opencode.command(turn);
    const config = JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT ?? "{}");
    expect(config.tools).toEqual({ "*": false, "dashi_*": true });
    expect(config.permission).toEqual({ edit: "deny", bash: "deny", webfetch: "deny" });
    expect(config.agent["dashi-plan"].prompt).toBe(HARNESS_PROMPT);
    expect(opencode.args.slice(-2)).toEqual(["--", "dark mode"]);
  });

  test("their output is read for the session, the words and what went wrong", () => {
    expect(HARNESSES["claude-code"].read('{"type":"result","subtype":"success","is_error":false,"result":"Done.","session_id":"abc"}', 0)).toEqual({
      session: "abc",
      text: "Done.",
      error: null,
    });
    expect(HARNESSES["claude-code"].read('{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"abc"}', 1).error).toBe("error_max_turns");
    expect(HARNESSES.codex.read('{"type":"thread.started","thread_id":"t1"}\n{"type":"turn.failed","error":{"message":"boom"}}', 1)).toEqual({
      session: "t1",
      text: "",
      error: "boom",
    });
    expect(HARNESSES.opencode.read('{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"ok"}}', 0)).toEqual({
      session: "ses_1",
      text: "ok",
      error: null,
    });
    expect(HARNESSES["claude-code"].signedOut("Not logged in · Please run /login")).toBe(true);
    expect(HARNESSES.codex.signedOut("MCP server dashi failed to start")).toBe(false);
  });

  test("a turn's environment keeps who and where, and no other provider's key", () => {
    const env = harnessEnv(
      HARNESSES["claude-code"],
      { HOME: "/home/alexk", PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-x", GITHUB_TOKEN: "g", LC_ALL: "C" },
      { A: "1" },
    );
    expect(env).toEqual({ HOME: "/home/alexk", PATH: "/usr/bin", LC_ALL: "C", TERM: "dumb", NO_COLOR: "1", A: "1" });
    expect(harnessEnv(HARNESSES.opencode, { OPENROUTER_API_KEY: "k", GITHUB_TOKEN: "g" }, {})).toMatchObject({ OPENROUTER_API_KEY: "k" });
    expect(harnessEnv(HARNESSES.opencode, { GITHUB_TOKEN: "g" }, {}).GITHUB_TOKEN).toBeUndefined();
  });

  test("a follow-up's prompt says how the last plan went", () => {
    expect(
      turnPrompt({
        text: "now quieter",
        results: [
          { id: "a", text: "Done.", error: false },
          { id: "b", text: "The person did not allow this step.", error: true },
        ],
      }),
    ).toBe(
      [
        "How the last plan went:",
        "- Step 1: done. Done.",
        "- Step 2: not done. The person did not allow this step.",
        "",
        "Now the person asks:",
        "now quieter",
      ].join("\n"),
    );
  });
});

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
    setTimeout(() => stop.abort(), 50);
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
