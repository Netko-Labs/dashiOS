import { describe, expect, test } from "bun:test";
import { HARNESS_PROMPT, HARNESSES, harnessEnv, turnPrompt } from "../src/agents/ask/harness/index.ts";

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
