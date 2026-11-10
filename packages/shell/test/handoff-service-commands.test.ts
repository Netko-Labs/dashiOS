import { describe, expect, test } from "bun:test";
import { TASK_PROMPT, taskCommand } from "../src/agents/handoff/lib/commands.ts";
import { exitLine, serviceArgs, type TurnStart } from "../src/agents/handoff/lib/runner.ts";
import { harnessOrder } from "../src/agents/handoff/order.ts";
import { taskOfCgroup } from "../src/agents/sandbox.ts";

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
