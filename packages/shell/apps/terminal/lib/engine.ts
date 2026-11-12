/**
 * dashi-term, the Terminal's engine (crates/dashi-term): it runs the shell on
 * a PTY and keeps the terminal in libghostty-vt; this process draws what it
 * says and sends it the person's input. One JSON object per line each way
 * (screen.ts parses what comes back).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { LineBuffer } from "../../../src/shared/io/index.ts";
import { type EngineMessage, parseEngineLine } from "./screen.ts";

/** What the app sends: crates/dashi-term/src/protocol.rs `Input`. */
export type EngineInput =
  | { t: "key"; key: string; text?: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; repeat: boolean }
  | { t: "paste"; text: string }
  | { t: "resize"; cols: number; rows: number; cw: number; ch: number }
  | { t: "scroll"; lines: number }
  | { t: "select"; phase: "down" | "move" | "up"; x: number; y: number; clicks: number }
  | { t: "select-all" }
  | { t: "copy" }
  /** The terminal's ink, ground, and 16 ANSI colors (palette.ts). */
  | { t: "colors"; fg: string; bg: string; palette: readonly string[] }
  | { t: "running" }
  /** Bring the prompt `prompts` before (−1, ❖↑) or after (1, ❖↓) the view's top into view. */
  | { t: "jump"; prompts: number }
  /** Select the output of the command whose prompt is on view row `y`. */
  | { t: "select-output"; y: number }
  /** ❖K: the scrollback goes (and the screen, at a prompt). */
  | { t: "clear" };

export interface EngineOptions {
  /** The folder the shell starts in; home when none. */
  cwd?: string | null;
  /** The shell integration's scripts (integration/), or null to start the shell without them. */
  integration?: string | null;
  /** A command to run in place of the shell (an app whose desktop entry says `Terminal=true`); its exit ends the tab. */
  command?: readonly string[] | null;
}

/** The shell integration's scripts, in the app's integration/ folder; `DASHI_TERMINAL_INTEGRATION=0` starts shells without them. */
export function integrationDir(env: Record<string, string | undefined> = process.env): string | null {
  return env.DASHI_TERMINAL_INTEGRATION === "0" ? null : join(import.meta.dir, "../integration");
}

export interface Engine {
  send(input: EngineInput): void;
  /** Hang up the shell (closing the window). */
  stop(): void;
  /**
   * What runs in front of the shell (a command, `ssh`, `vim`): its name, ""
   * when it has none, or null at the prompt, and null too when the engine
   * doesn't answer in time or is gone.
   */
  running(): Promise<string | null>;
}

/** How long a `running` question waits for its answer (ms). */
const RUNNING_WAIT = 400;

/** Where dashi-term is: `DASHI_TERM`, the installed one, or this checkout's build. */
export function engineBinary(env: Record<string, string | undefined> = process.env, exists: (path: string) => boolean = existsSync): string | null {
  const candidates = [env.DASHI_TERM, "/usr/libexec/dashi/dashi-term", join(import.meta.dir, "../../../../../crates/dashi-term/target/release/dashi-term")];
  return candidates.find((path): path is string => typeof path === "string" && path !== "" && exists(path)) ?? null;
}

/**
 * The Terminal's arguments (`[host] [-e COMMAND...]`), split at the first
 * `-e`: its own before, and the command its first tab runs after (null when
 * there is none). Not `--`: Bun drops a `--` that follows the script.
 */
export function splitCommand(args: readonly string[]): { own: string[]; command: string[] | null } {
  const at = args.indexOf("-e");
  if (at < 0) return { own: [...args], command: null };
  const command = args.slice(at + 1);
  return { own: args.slice(0, at), command: command.length > 0 ? command : null };
}

/** dashi-term's command line. */
export function engineArgs(binary: string, size: { cols: number; rows: number }, options: EngineOptions, home: string | undefined): string[] {
  const cwd = options.cwd ?? home;
  return [
    binary,
    "--cols",
    String(size.cols),
    "--rows",
    String(size.rows),
    ...(cwd ? ["--cwd", cwd] : []),
    ...(options.command?.length ? [] : options.integration ? ["--integration", options.integration] : []),
    ...(options.command?.length ? ["--", ...options.command] : []),
  ];
}

/**
 * Start a dashi-term. `onMessage` hears what it says, and `gone` if it goes
 * away without saying the shell exited (it crashed, or couldn't start one).
 */
export function startEngine(
  binary: string,
  size: { cols: number; rows: number },
  onMessage: (message: EngineMessage) => void,
  options: EngineOptions = {},
): Engine {
  const child = Bun.spawn(engineArgs(binary, size, options, process.env.HOME), {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  const lines = new LineBuffer();
  // Answers to `running` come back in the order the questions went.
  const asking: ((program: string | null) => void)[] = [];
  let open = true;
  void (async () => {
    let exited = false;
    try {
      for await (const chunk of child.stdout) {
        for (const line of lines.push(chunk)) {
          const message = parseEngineLine(line);
          if (message?.t === "running") asking.shift()?.(message.program);
          else if (message) {
            exited ||= message.t === "exit";
            onMessage(message);
          }
        }
      }
    } catch {}
    for (const answer of asking.splice(0)) answer(null);
    // Hung up on purpose (`stop`): the tab is closing, there is no one to tell.
    if (!exited && open) {
      open = false;
      onMessage({ t: "gone" });
    }
  })();
  const engine: Engine = {
    running() {
      if (!open) return Promise.resolve(null);
      return new Promise((resolve) => {
        let answered = false;
        const answer = (program: string | null): void => {
          if (answered) return;
          answered = true;
          clearTimeout(timer);
          resolve(program);
        };
        // Too late: the answer, when it comes, still takes its place in the queue.
        const timer = setTimeout(() => answer(null), RUNNING_WAIT);
        asking.push(answer);
        engine.send({ t: "running" });
      });
    },
    send(input) {
      if (!open) return;
      try {
        child.stdin.write(`${JSON.stringify(input)}\n`);
        void child.stdin.flush();
      } catch {
        open = false;
      }
    },
    stop() {
      if (!open) return;
      open = false;
      try {
        void child.stdin.end();
      } catch {}
    },
  };
  return engine;
}
