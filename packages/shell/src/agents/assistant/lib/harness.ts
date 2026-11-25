/**
 * Way one (decisions.md D148): a harness the person set up (Claude Code,
 * Codex, OpenCode) drives Dashi's tools for one spoken ask. It runs
 * headless in Dashi's agent sandbox with the task profile, exactly as a run
 * from the launcher does (agents/handoff/lib/turns.ts): an empty home but
 * its own login, no display, no bus, and of Dashi only the full MCP server's
 * socket. Its scope is named for the conversation, so the server gives its
 * connection the assistant's policy. Its events are read as they are
 * printed: what it says goes to speech at once, sentence by sentence.
 *
 * Claude Code (checked against `claude --help` 2.1.325, not run here):
 * `-p --output-format stream-json --verbose --include-partial-messages`
 * with the prompt on stdin, `--system-prompt` (Dashi's words in place of a
 * coding agent's), `--tools ""`, `--strict-mcp-config --mcp-config {dashi}`,
 * `--allowedTools mcp__dashi`, `--permission-mode dontAsk`,
 * `--setting-sources ""`, `--effort low`, and `--resume <id>` for every ask
 * after a conversation's first. Codex and OpenCode take the launcher runs'
 * command lines (handoff/lib/commands.ts); OpenCode's is by its version
 * (ask/harness/opencode.ts), and was run end to end in the VM (D691).
 */

import { join } from "node:path";
import {
  type Files,
  findHarness,
  HARNESSES,
  type HarnessCommand,
  type HarnessId,
  type HarnessTurn,
  harnessEnv,
  PLAN_SERVER,
  type Probe,
  type ShellPaths,
  turnVersion,
} from "../../ask/index.ts";
import { eventsOf, lineObject, taskCommand } from "../../handoff/index.ts";
import { taskSocket, unitName } from "../../sandbox.ts";

/** The command line for one spoken ask with Claude Code. */
export function claudeCommand(turn: HarnessTurn): HarnessCommand {
  const config = { mcpServers: { [PLAN_SERVER]: { type: "stdio", command: turn.mcp.command, args: [...turn.mcp.args], env: { ...turn.mcp.env } } } };
  return {
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
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
      ...(turn.model ? ["--model", turn.model] : []),
      ...(turn.session ? ["--resume", turn.session] : []),
    ],
    stdin: turn.prompt,
    env: { DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
  };
}

export const assistantCommand = (harness: HarnessId, turn: HarnessTurn): HarnessCommand =>
  harness === "claude-code" ? claudeCommand(turn) : taskCommand(harness, turn);

/** A harness process for one ask: its lines as they are printed, how it ended, and how to stop it. */
export interface Spawned {
  pid: number | null;
  /** Each line of stdout as it comes; resolves when the stream ends. */
  lines(onLine: (line: string) => void): Promise<void>;
  /** Its exit code (null when a signal ended it), and the end of what it wrote to its errors. */
  exited: Promise<{ code: number | null; errors: string }>;
  stop(): void;
}

export type Spawner = (argv: readonly string[], options: { env: Record<string, string>; stdin: string; unit(pid: number): string }) => Spawned;

const STOP_GRACE_MS = 2_000;

/** The session's spawner: Bun.spawn, stdout read as it comes, and a stop that reaches the scope when SIGTERM is not enough. */
export const hostSpawner: Spawner = (argv, { env, stdin, unit }) => {
  const child = Bun.spawn([...argv], { env, stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" });
  const errors = new Response(child.stderr).text().then((text) => text.trim().slice(-400));
  let stopped = false;
  return {
    pid: child.pid,
    async lines(onLine) {
      const decoder = new TextDecoder();
      let rest = "";
      for await (const chunk of child.stdout) {
        rest += decoder.decode(chunk, { stream: true });
        for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
          onLine(rest.slice(0, at));
          rest = rest.slice(at + 1);
        }
      }
      if (rest.trim()) onLine(rest);
    },
    exited: child.exited.then(async (code) => ({ code: child.signalCode ? null : code, errors: await errors })),
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill("SIGTERM");
      const timer = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGKILL");
        Bun.spawn(["systemctl", "--user", "stop", unit(child.pid)], { stdio: ["ignore", "ignore", "ignore"] });
      }, STOP_GRACE_MS);
      void child.exited.then(() => clearTimeout(timer));
    },
  };
};

export interface HarnessHost {
  env: Readonly<Record<string, string | undefined>>;
  shell: ShellPaths;
  files: Files;
  spawn?: Spawner;
  /** Asks the program its version (`--version`), for a harness whose command line depends on it (OpenCode). */
  probe?: Probe;
  /** For tests: run the harness itself, not through dashi-agent (no bubblewrap or systemd there). */
  direct?: boolean;
}

export interface HarnessAsk {
  /** The model to run with; its own default when null or unset. */
  model?: string | null;
  harness: HarnessId;
  /** The conversation's id: its sandbox's scope is `task-<id>`. */
  task: string;
  prompt: string;
  system: string;
  session: string | null;
  signal: AbortSignal;
  /** Words as they are written. */
  say(text: string): void;
}

export interface HarnessEnd {
  /** Its session, for the next ask's `--resume`. */
  session: string | null;
  /** Everything it said, in order. */
  said: string;
  /** What went wrong, in its words; null when it ended well. */
  error: string | null;
  /** "not-installed", or null. */
  missing: boolean;
}

/** The text of a Claude Code `stream_event` line's delta ("" for any other line). */
function partialText(line: string): string {
  const object = lineObject(line);
  if (object?.type !== "stream_event") return "";
  const event = object.event;
  if (typeof event !== "object" || event === null || !("delta" in event)) return "";
  const delta = event.delta;
  return typeof delta === "object" && delta !== null && "type" in delta && delta.type === "text_delta" && "text" in delta && typeof delta.text === "string"
    ? delta.text
    : "";
}

/**
 * Words from the stream without saying any twice: a harness that prints
 * partial chunks prints the whole message after them, so of a whole message
 * only what the chunks did not already give is said.
 */
export class SaidOnce {
  /** The chunks of the message being written. */
  private streamed = "";
  /** Everything said, in order. */
  whole = "";

  constructor(private readonly say: (text: string) => void) {}

  private emit(text: string): void {
    this.whole += text;
    this.say(text);
  }

  partial(text: string): void {
    this.streamed += text;
    this.emit(text);
  }

  message(text: string): void {
    const given = this.streamed.trim();
    const whole = text.trim();
    this.streamed = "";
    // Chunks that are not the start of the whole message were said already: nothing is said twice.
    const more = given === "" ? whole : whole.startsWith(given) ? whole.slice(given.length) : "";
    if (more) this.emit(more);
    // A message ends a paragraph: the next one is not run into it.
    this.emit("\n\n");
  }
}

/** Run one ask through the harness; resolves when its turn ends, is stopped, or fails. */
export async function askHarness(host: HarnessHost, ask: HarnessAsk): Promise<HarnessEnd> {
  const home = host.env.HOME ?? "";
  const runtime = host.env.XDG_RUNTIME_DIR ?? "";
  const spec = HARNESSES[ask.harness];
  const where = home ? findHarness(spec, home, host.env.PATH, host.files) : null;
  if (!where || !runtime) return { session: ask.session, said: "", error: null, missing: true };
  const { shell } = host;
  const bridgeEnv: Record<string, string> = host.direct ? { DASHI_MCP_SOCKET: taskSocket(runtime) } : {};
  const mcp = { command: shell.bun, args: host.direct ? [shell.bridge] : [shell.bridge, "--reconnect"], env: bridgeEnv };
  const command = assistantCommand(ask.harness, {
    prompt: ask.prompt,
    system: ask.system,
    session: ask.session,
    mcp,
    version: await turnVersion(spec, where, host.probe),
    ...(ask.model ? { model: ask.model } : {}),
  });
  const profile = {
    socket: taskSocket(runtime),
    readOnly: [...where.readOnly, ...[shell.bun, shell.bridge].filter((path) => path.startsWith(`${home}/`))],
    state: spec.state(home, host.env),
    cwd: join(runtime, "dashi-assistant"),
    task: true,
  };
  const name = `task-${ask.task}`;
  const argv = host.direct ? [where.program, ...command.args] : [shell.bun, shell.dashiAgent, "--name", name, "--", where.program, ...command.args];
  const env = harnessEnv(spec, host.env, { ...command.env, ...(host.direct ? {} : { DASHI_AGENT_PLAN: JSON.stringify(profile) }) });
  const running = (host.spawn ?? hostSpawner)(argv, { env, stdin: command.stdin, unit: (pid) => unitName(name, pid) });
  const stop = (): void => running.stop();
  ask.signal.addEventListener("abort", stop, { once: true });
  if (ask.signal.aborted) stop();
  let session = ask.session;
  let error: string | null = null;
  const said = new SaidOnce(ask.say);
  try {
    await running.lines((line) => {
      const partial = partialText(line);
      if (partial) return said.partial(partial);
      for (const event of eventsOf(ask.harness, line)) {
        if (event.kind === "session") session = event.id;
        else if (event.kind === "said") said.message(event.text);
        else if (event.kind === "failed") error = event.error;
      }
    });
    const { code, errors } = await running.exited;
    if (code !== 0 && error === null && !ask.signal.aborted) error = errors || `It ended with code ${code ?? "none"}.`;
  } finally {
    ask.signal.removeEventListener("abort", stop);
  }
  return { session, said: said.whole.trim(), error, missing: false };
}
