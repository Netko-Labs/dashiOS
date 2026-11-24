/**
 * The harnesses that can answer the launcher (docs/actions.md, "Plan
 * mode"), as data: where each is installed, what it signs in with, what of
 * the home folder it needs, and its command line for one headless turn with
 * only Dashi's plan-mode MCP server for tools.
 *
 * - Claude Code: checked against `claude --help` 2.1.317 on the build
 *   machine. `-p` with the prompt on stdin (`--allowedTools` and
 *   `--mcp-config` take several values, so a prompt after them would be
 *   read as one), `--output-format json` (one result object with
 *   `session_id`), `--tools ""` (no built-in tool: no shell, files or web),
 *   `--strict-mcp-config` with only `dashi`, `--allowedTools mcp__dashi`
 *   and `--permission-mode dontAsk` (anything else is denied, nobody is
 *   asked), `--setting-sources ""` (no hooks or plugins from the person's
 *   settings), `--system-prompt`, `--resume <session>` for a follow-up.
 *   Signed in: `claude auth status --json` (`loggedIn`), no model call.
 * - Codex isn't installed on the build machine: its line comes from its docs
 *   (developers.openai.com/codex) and is UNVERIFIED until the VM test runs
 *   it. `codex exec --json` (JSONL: `thread.started` with `thread_id`,
 *   `item.completed` items, `turn.failed`, `error`), the prompt on stdin
 *   (`-`), `--sandbox read-only`, `--ignore-user-config`, `-c` overrides
 *   turning the shell tool and web search off and adding `mcp_servers.dashi`,
 *   and `exec resume <id>`; signed in: `codex login status` exits 0.
 * - OpenCode: opencode.ts, the one place that says how Dashi runs it.
 */

import { join } from "node:path";
import type { HarnessId } from "../answerer.ts";
import { isRaw, jsonLines, lastJson, str, toml } from "./lib/harness-text.ts";
import { opencode } from "./opencode.ts";
import { type HarnessSpec, PLAN_SERVER, signedOutWords } from "./spec.ts";

const claudeCode: HarnessSpec = {
  id: "claude-code",
  binary: "claude",
  dirs: [".local/bin", ".claude/local"],
  uses: "Your Claude subscription",
  install: "curl -fsSL https://claude.ai/install.sh | bash",
  signIn: ["auth", "login"],
  state: (home, env) => {
    const config = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
    // ~/.claude.json holds its account and settings beside ~/.claude, unless CLAUDE_CONFIG_DIR moved both.
    return env.CLAUDE_CONFIG_DIR ? [config] : [config, join(home, ".claude.json")];
  },
  signedIn: {
    kind: "command",
    args: ["auth", "status", "--json"],
    read(stdout) {
      const status = lastJson(stdout);
      return typeof status?.loggedIn === "boolean" ? status.loggedIn : null;
    },
  },
  command(turn) {
    const config = { mcpServers: { [PLAN_SERVER]: { type: "stdio", command: turn.mcp.command, args: [...turn.mcp.args], env: { ...turn.mcp.env } } } };
    return {
      args: [
        "-p",
        "--output-format",
        "json",
        "--system-prompt",
        turn.system,
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        JSON.stringify(config),
        "--allowedTools",
        `mcp__${PLAN_SERVER}`,
        "--permission-mode",
        "dontAsk",
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--no-chrome",
        "--effort",
        "low",
        ...(turn.session ? ["--resume", turn.session] : []),
      ],
      stdin: turn.prompt,
      // Its own login, not a key the session may have; no updates from inside a read-only install.
      env: { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    };
  },
  read(stdout) {
    const result = lastJson(stdout);
    if (!result) return { session: null, text: "", error: str(stdout) ? stdout.trim().slice(-200) : "Claude Code said nothing." };
    const session = str(result.session_id);
    const text = str(result.result) ?? "";
    const failed = result.is_error === true || (typeof result.subtype === "string" && result.subtype !== "success");
    return { session, text: failed ? "" : text, error: failed ? text || String(result.subtype ?? "error") : null };
  },
  signedOut: signedOutWords,
};

const codex: HarnessSpec = {
  id: "codex",
  binary: "codex",
  dirs: [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin"],
  uses: "Your ChatGPT plan",
  install: "npm install -g @openai/codex",
  signIn: ["login"],
  state: (home, env) => [env.CODEX_HOME || join(home, ".codex")],
  signedIn: { kind: "command", args: ["login", "status"], read: (_stdout, code) => (code === null ? null : code === 0) },
  command(turn) {
    const server = `mcp_servers.${PLAN_SERVER}`;
    const env = Object.entries(turn.mcp.env)
      .map(([name, value]) => `${name}=${toml(value)}`)
      .join(", ");
    const overrides = [
      "features.shell_tool=false",
      'web_search="disabled"',
      'approval_policy="never"',
      `${server}.command=${toml(turn.mcp.command)}`,
      `${server}.args=[${turn.mcp.args.map(toml).join(", ")}]`,
      `${server}.env={${env}}`,
      `${server}.default_tools_approval_mode="approve"`,
      `${server}.required=true`,
    ];
    return {
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        ...overrides.flatMap((value) => ["-c", value]),
        ...(turn.session ? ["resume", turn.session] : []),
        "-",
      ],
      // Codex has no flag for the whole system prompt: Dashi's goes first, every turn.
      stdin: `${turn.system}\n\n${turn.prompt}`,
      env: {},
    };
  },
  read(stdout) {
    let session: string | null = null;
    let text = "";
    let error: string | null = null;
    for (const event of jsonLines(stdout)) {
      if (event.type === "thread.started") session = str(event.thread_id) ?? session;
      const item = isRaw(event.item) ? event.item : null;
      if (event.type === "item.completed" && item && (item.type === "agent_message" || item.type === "assistant_message")) text = str(item.text) ?? text;
      const failure = isRaw(event.error) ? str(event.error.message) : str(event.message);
      if (event.type === "turn.failed" || event.type === "error") error = failure ?? "Codex stopped.";
    }
    return { session, text: error ? "" : text, error };
  },
  signedOut: signedOutWords,
};

export const HARNESSES: Readonly<Record<HarnessId, HarnessSpec>> = { "claude-code": claudeCode, codex, opencode };

/** What to type in Terminal to sign an answerer in ("claude auth login"); null for one that isn't a harness. */
export function signInCommand(id: string): string | null {
  const spec = (HARNESSES as Readonly<Record<string, HarnessSpec | undefined>>)[id];
  return spec ? [spec.binary, ...spec.signIn].join(" ") : null;
}
