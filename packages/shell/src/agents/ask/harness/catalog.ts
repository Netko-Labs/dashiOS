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
 * - Codex and OpenCode aren't installed on the build machine: their lines
 *   come from their docs (developers.openai.com/codex, opencode.ai/docs) and
 *   are UNVERIFIED until the VM test runs them. Codex: `codex exec --json`
 *   (JSONL: `thread.started` with `thread_id`, `item.completed` items,
 *   `turn.failed`, `error`), the prompt on stdin (`-`), `--sandbox
 *   read-only`, `--ignore-user-config`, `-c` overrides turning the shell
 *   tool and web search off and adding `mcp_servers.dashi`, and `exec
 *   resume <id>`; signed in: `codex login status` exits 0. OpenCode:
 *   `opencode run --format json` (JSON events carrying `sessionID`), its
 *   config inline in `OPENCODE_CONFIG_CONTENT` (every tool off but
 *   `dashi_*`, edits, shell and fetches denied, an agent with Dashi's
 *   prompt), `--session <id>`; signed in: its `auth.json` lists a provider.
 */

import { join } from "node:path";
import type { HarnessId } from "../answerer.ts";

/** What a turn's command line is built from. */
export interface HarnessTurn {
  /** The prompt for this turn (the request, or a follow-up with how the last plan went). */
  prompt: string;
  /** What the harness is told before anything (answerer.ts SYSTEM_PROMPT, for plan mode). */
  system: string;
  /** The harness's own session to continue, from its last turn; null on the first. */
  session: string | null;
  /** Dashi's plan-mode server, as a stdio MCP server the harness starts: the bridge and its socket. */
  mcp: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> };
}

/** A turn's command line: the arguments after the program, what goes on stdin, and variables to add. */
export interface HarnessCommand {
  args: string[];
  stdin: string;
  env: Record<string, string>;
}

/** What a finished run printed, read. */
export interface HarnessOutput {
  /** Its session, for a follow-up; null when it didn't say. */
  session: string | null;
  /** Its last words (empty when it only made calls). */
  text: string;
  /** What went wrong, in its words; null when it ended well. */
  error: string | null;
}

export interface HarnessSpec {
  id: HarnessId;
  /** The program's name on PATH. */
  binary: string;
  /** Where its installers put it besides PATH, under the home folder. */
  dirs: readonly string[];
  /** What it answers with, on its row: "Your Claude subscription". */
  uses: string;
  /** How to install it, shown while it isn't. */
  install: string;
  /** How to sign in, in Terminal: the arguments after the program. */
  signIn: readonly string[];
  /**
   * What of the home folder it needs, bound read-write into its sandbox
   * (its login, and the sessions a follow-up resumes); nothing else of the
   * home folder is there. `env` is the session's environment, for a folder
   * the person moved (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*).
   */
  state(home: string, env: Readonly<Record<string, string | undefined>>): string[];
  /** Variables of the session it may see beside the basic ones (a provider's key, for OpenCode). */
  passEnv?: RegExp;
  /** Whether it is signed in, without a model call; null when that can't be told cheaply. */
  signedIn:
    | { kind: "command"; args: readonly string[]; read(stdout: string, code: number | null): boolean | null }
    | { kind: "file"; path(home: string, env: Readonly<Record<string, string | undefined>>): string; read(text: string): boolean | null };
  command(turn: HarnessTurn): HarnessCommand;
  read(stdout: string, code: number | null): HarnessOutput;
  /** Whether its error means it isn't signed in (or its login lapsed). */
  signedOut(error: string): boolean;
}

/** The plan-mode server's name in every harness: its tools are `mcp__dashi__*`, `dashi_*`. */
export const PLAN_SERVER = "dashi";

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function jsonLines(stdout: string): Raw[] {
  return stdout.split("\n").flatMap((line) => {
    const text = line.trim();
    if (!text.startsWith("{")) return [];
    try {
      const value: unknown = JSON.parse(text);
      return isRaw(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

/** The last JSON object a program printed (some print a banner first). */
function lastJson(stdout: string): Raw | null {
  const whole = stdout.trim();
  try {
    const value: unknown = JSON.parse(whole);
    if (isRaw(value)) return value;
  } catch {
    // Not one object: look line by line.
  }
  return jsonLines(stdout).at(-1) ?? null;
}

/** A TOML basic string (JSON's escapes are TOML's for these characters). */
const toml = (value: string): string => JSON.stringify(value);

const SIGNED_OUT = /not logged in|log ?in|sign ?in|unauthori[sz]ed|\b401\b|authenticat|oauth|token (?:has )?expired|invalid api key|api key/i;

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
  signedOut: (error) => SIGNED_OUT.test(error),
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
  signedOut: (error) => SIGNED_OUT.test(error),
};

const opencode: HarnessSpec = {
  id: "opencode",
  binary: "opencode",
  dirs: [".opencode/bin", ".local/bin", ".bun/bin", ".npm-global/bin"],
  uses: "OpenCode's configured provider",
  install: "curl -fsSL https://opencode.ai/install | bash",
  signIn: ["auth", "login"],
  state: (home, env) => {
    const data = env.XDG_DATA_HOME || join(home, ".local/share");
    const config = env.XDG_CONFIG_HOME || join(home, ".config");
    const state = env.XDG_STATE_HOME || join(home, ".local/state");
    const cache = env.XDG_CACHE_HOME || join(home, ".cache");
    return [join(data, "opencode"), join(config, "opencode"), join(state, "opencode"), join(cache, "opencode")];
  },
  // Its provider may be configured by a key in the session.
  passEnv: /^(?:[A-Z0-9_]+_API_KEY|OPENCODE_[A-Z0-9_]+|AWS_[A-Z0-9_]+|GOOGLE_[A-Z0-9_]+|AZURE_[A-Z0-9_]+)$/,
  signedIn: {
    kind: "file",
    path: (home, env) => join(env.XDG_DATA_HOME || join(home, ".local/share"), "opencode", "auth.json"),
    read(text) {
      try {
        const auth: unknown = JSON.parse(text);
        return isRaw(auth) && Object.keys(auth).length > 0 ? true : null;
      } catch {
        return null;
      }
    },
  },
  command(turn) {
    const tools = { "*": false, [`${PLAN_SERVER}_*`]: true };
    const config = {
      mcp: { [PLAN_SERVER]: { type: "local", command: [turn.mcp.command, ...turn.mcp.args], environment: { ...turn.mcp.env }, enabled: true } },
      tools,
      permission: { edit: "deny", bash: "deny", webfetch: "deny" },
      agent: { "dashi-plan": { description: "Plans actions on Dashi", mode: "primary", prompt: turn.system, tools } },
    };
    return {
      args: ["run", "--format", "json", "--agent", "dashi-plan", ...(turn.session ? ["--session", turn.session] : []), "--", turn.prompt],
      stdin: "",
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    };
  },
  read(stdout) {
    let session: string | null = null;
    const text: string[] = [];
    let error: string | null = null;
    for (const event of jsonLines(stdout)) {
      session = str(event.sessionID) ?? session;
      const part = isRaw(event.part) ? event.part : null;
      if (event.type === "text" && part) {
        const words = str(part.text);
        if (words) text.push(words);
      }
      if (event.type === "error") {
        const inner = isRaw(event.error) ? event.error : null;
        const data = inner && isRaw(inner.data) ? inner.data : null;
        error = str(data?.message) ?? str(inner?.message) ?? str(inner?.name) ?? "OpenCode stopped.";
      }
    }
    return { session, text: error ? "" : text.join("\n").trim(), error };
  },
  signedOut: (error) => SIGNED_OUT.test(error),
};

export const HARNESSES: Readonly<Record<HarnessId, HarnessSpec>> = { "claude-code": claudeCode, codex, opencode };

/** What to type in Terminal to sign an answerer in ("claude auth login"); null for one that isn't a harness. */
export function signInCommand(id: string): string | null {
  const spec = (HARNESSES as Readonly<Record<string, HarnessSpec | undefined>>)[id];
  return spec ? [spec.binary, ...spec.signIn].join(" ") : null;
}
