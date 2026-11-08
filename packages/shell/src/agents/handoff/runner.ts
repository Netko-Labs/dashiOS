/**
 * Running a task's turn in the background (docs/actions.md, "Agents from
 * the launcher"): a transient user service, `dashi-task-<run>-<turn>.service`
 * (`systemd-run --user`, as applets run), whose main process is
 * `dashi-task` (bin/dashi-task.ts) running the harness through `dashi-agent`
 * with a task profile (sandbox.ts `PlanProfile`, `task: true`). No Terminal
 * opens, and closing the launcher (or the shell restarting) never stops it:
 * its stream is a file under `$XDG_RUNTIME_DIR/dashi-agents/<run>/`, read as
 * it grows. Stop is `systemctl --user stop` of the unit.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One turn to start. */
export interface TurnStart {
  run: string;
  turn: number;
  /** The command after `dashi-task --log … --prompt … --`. */
  argv: readonly string[];
  stdin: string;
  env: Readonly<Record<string, string>>;
}

export interface TaskRunner {
  /** Start a turn; an error in words when systemd wouldn't. */
  start(turn: TurnStart): Promise<string | null>;
  stop(run: string, turn: number): void;
  /** Read a turn's stream from the start, then as it grows: each line, and its exit code once it ends. */
  watch(run: string, turn: number, onLine: (line: string) => void, onExit: (code: number | null) => void): () => void;
  /** A run's files go (it ended over an hour ago, or Dashi's session ends). */
  forget(run: string): void;
}

/** Where a run's streams and prompts are. */
export const runsDir = (runtime: string): string => join(runtime, "dashi-agents");
export const unitOf = (run: string, turn: number): string => `dashi-task-${run}-${turn}.service`;

/** The line dashi-task ends a stream with. */
export function exitLine(line: string): { code: number | null } | null {
  if (!line.startsWith('{"dashi":')) return null;
  try {
    const value = JSON.parse(line) as { dashi?: unknown; code?: unknown };
    if (value.dashi !== "exit") return null;
    return { code: typeof value.code === "number" ? value.code : null };
  } catch {
    return null;
  }
}

/** systemd-run's arguments for a turn (pure, tested). */
export function serviceArgs(unit: string, task: string, start: TurnStart, files: { stream: string; prompt: string }, bun: string): string[] {
  return [
    "systemd-run",
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--description=Dashi agent task ${start.run}`,
    ...Object.entries(start.env).map(([name, value]) => `--setenv=${name}=${value}`),
    "--",
    bun,
    task,
    "--log",
    files.stream,
    "--prompt",
    files.prompt,
    "--",
    ...start.argv,
  ];
}

/** How often a stream is looked at for new lines while its turn runs. */
const POLL_MS = 250;

export function systemdRunner(options: { runtime: string; bun: string; task: string }): TaskRunner {
  const dirOf = (run: string) => join(runsDir(options.runtime), run);
  const filesOf = (run: string, turn: number) => ({ stream: join(dirOf(run), `turn-${turn}.jsonl`), prompt: join(dirOf(run), `turn-${turn}.prompt`) });
  return {
    async start(start) {
      const files = filesOf(start.run, start.turn);
      try {
        mkdirSync(dirOf(start.run), { recursive: true, mode: 0o700 });
        writeFileSync(files.prompt, start.stdin, { mode: 0o600 });
        writeFileSync(files.stream, "", { mode: 0o600 });
      } catch (error) {
        return `Couldn't write its files (${error instanceof Error ? error.message : String(error)}).`;
      }
      const child = Bun.spawn(serviceArgs(unitOf(start.run, start.turn), options.task, start, files, options.bun), {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      return code === 0 ? null : error.trim() || `systemd-run ended with code ${code}.`;
    },
    stop(run, turn) {
      Bun.spawn(["systemctl", "--user", "stop", "--no-block", unitOf(run, turn)], { stdio: ["ignore", "ignore", "ignore"] });
    },
    watch(run, turn, onLine, onExit) {
      const { stream } = filesOf(run, turn);
      let offset = 0;
      let pending = "";
      let reading = false;
      let ended = false;
      const read = async () => {
        if (reading || ended) return;
        reading = true;
        try {
          const size = existsSync(stream) ? statSync(stream).size : 0;
          if (size > offset) {
            const text = await Bun.file(stream).slice(offset, size).text();
            offset = size;
            const lines = (pending + text).split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) {
              if (ended) break;
              const exit = exitLine(line);
              if (exit) {
                ended = true;
                clearInterval(timer);
                onExit(exit.code);
              } else if (line.trim()) onLine(line);
            }
          }
        } catch (error) {
          console.error("dashi-shell: an agent's stream:", error);
        } finally {
          reading = false;
        }
      };
      const timer = setInterval(() => void read(), POLL_MS);
      void read();
      return () => {
        ended = true;
        clearInterval(timer);
      };
    },
    forget(run) {
      rmSync(dirOf(run), { recursive: true, force: true });
    },
  };
}
