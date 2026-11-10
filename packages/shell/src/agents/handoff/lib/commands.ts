/**
 * A harness's command line for one turn of a task from the launcher
 * (docs/actions.md, "Agents from the launcher"), as data: headless, its
 * events streamed as JSON lines (stream.ts), its own tools off, and Dashi's
 * MCP server (through `dashi-mcp`, at the socket the sandbox binds in) for
 * tools. A follow-up resumes its session.
 *
 * - Claude Code (checked against `claude --help` 2.1.319, and a stream
 *   recorded with it): `-p` with the prompt on stdin, `--output-format
 *   stream-json --verbose` (stream-json needs --verbose with -p),
 *   `--append-system-prompt` (Dashi's words after Claude Code's own),
 *   `--tools ""` (no shell, files or web of its own),
 *   `--strict-mcp-config --mcp-config {dashi}`, `--allowedTools mcp__dashi`,
 *   `--permission-mode dontAsk`, `--setting-sources ""` (no hooks or
 *   plugins), `--disable-slash-commands`, `--no-chrome`; `--resume <id>`.
 * - Codex (checked against codex-cli 0.167.0's `--help`, and run signed
 *   out: it starts its thread and stops at 401): `codex exec --json` as plan
 *   mode runs it (catalog.ts), the shell tool and web search off,
 *   `mcp_servers.dashi` approved; `exec … resume <id> -`.
 * - OpenCode (checked against opencode 1.19.5's `--help`, and run with no
 *   account: it makes its session with the `dashi-task` agent, then its free
 *   model's limit stops it, printing no event): `opencode run --format json
 *   --agent dashi-task`, its config in `OPENCODE_CONFIG_CONTENT` (only
 *   `dashi_*` tools; edits, shell and fetches denied); `--session <id>`.
 */

import { type HarnessCommand, type HarnessId, type HarnessTurn, PLAN_SERVER } from "../../ask/index.ts";

/** What every harness running a task is told, after its own system prompt. */
export const TASK_PROMPT = [
  "You are working for the person in the background on Dashi, a Linux desktop. They are not watching and can't answer you in text.",
  "Use Dashi's tools (the dashi MCP server): websites through open_url, read_page, click_element, fill_element, select_option, press and scroll_page;",
  "sign in with sign_in and fill_code, and pay with pay: Dashi asks the person and types the secret, you never see it.",
  "For what only the person can do (a CAPTCHA, a code sent to their phone), use hand_over on the window you were told of, if any; otherwise stop and say what's needed.",
  "Before your first tool call, say your plan in one line as 'Steps: N' (about how many tool calls it takes).",
  'When you are done, end with one short sentence that says what you did, for a notification ("Booked your spinning class for Thursday 7:00"), then at most one line of details.',
].join(" ");

const toml = (value: string): string => JSON.stringify(value);

function claudeCode(turn: HarnessTurn): HarnessCommand {
  const config = { mcpServers: { [PLAN_SERVER]: { type: "stdio", command: turn.mcp.command, args: [...turn.mcp.args], env: { ...turn.mcp.env } } } };
  return {
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
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
      ...(turn.session ? ["--resume", turn.session] : []),
    ],
    stdin: turn.prompt,
    env: { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  };
}

function codex(turn: HarnessTurn): HarnessCommand {
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
    stdin: `${turn.system}\n\n${turn.prompt}`,
    env: {},
  };
}

function opencode(turn: HarnessTurn): HarnessCommand {
  const tools = { "*": false, [`${PLAN_SERVER}_*`]: true };
  const config = {
    mcp: { [PLAN_SERVER]: { type: "local", command: [turn.mcp.command, ...turn.mcp.args], environment: { ...turn.mcp.env }, enabled: true } },
    tools,
    permission: { edit: "deny", bash: "deny", webfetch: "deny" },
    agent: { "dashi-task": { description: "Works on a task on Dashi", mode: "primary", prompt: turn.system, tools } },
  };
  return {
    args: ["run", "--format", "json", "--agent", "dashi-task", ...(turn.session ? ["--session", turn.session] : []), "--", turn.prompt],
    stdin: "",
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  };
}

const COMMANDS: Readonly<Record<HarnessId, (turn: HarnessTurn) => HarnessCommand>> = { "claude-code": claudeCode, codex, opencode };

/** The command line for a task's turn with this harness. */
export const taskCommand = (harness: HarnessId, turn: HarnessTurn): HarnessCommand => COMMANDS[harness](turn);
