/**
 * Running a task's turn in the background (docs/actions.md, "Agents from
 * the launcher"): a transient user service, `dashi-task-<run>-<turn>.service`
 * (`systemd-run --user`, as applets run), whose main process is
 * `dashi-task` (bin/dashi-task.ts) running the harness through `dashi-agent`
 * with a task profile (sandbox.ts `PlanProfile`, `task: true`). No Terminal
 * opens, and closing the launcher (or the shell restarting) never stops it:
 * its stream is a file under `$XDG_RUNTIME_DIR/dashi-agents/<run>/`, read as
 * it grows, beside the run's record (`run.json`, records.ts). Stop is
 * `systemctl --user stop` of the unit. A shell that starts finds the runs
 * there and the units still running (`found`) and picks them up again.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lastErrors } from "./quiet.ts";
import { isRunId, parseRecord, type RunRecord, runningUnits } from "./records.ts";

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
  /** Keep a run's record beside its streams. */
  save(record: RunRecord): void;
  /** A turn's stream as it is now, whole; null when there is none. */
  readTurn(run: string, turn: number): TurnRead | null;
  /** What the harness wrote to its errors in a turn so far (the end of it); empty when nothing. */
  readErrors?(run: string, turn: number): string;
  /** The runs on disk and the units still running: what a shell that starts picks up again. */
  found(): FoundRuns;
}

/** A turn's stream read whole. */
export interface TurnRead {
  lines: string[];
  /** Its exit line's code, or undefined while it has none. */
  exit: { code: number | null } | undefined;
  /** When it last changed (ms): when the turn ended, once it has. */
  changed: number;
}

/** A run's folder as a shell that starts finds it. */
export interface FoundRun {
  id: string;
  record: RunRecord | null;
  /** Its last turn with a stream. */
  turn: number;
  /** Its first turn's prompt, and when it was written (when the run started), for a run without a record. */
  prompt: string;
  promptAt: number;
}

export interface FoundRuns {
  runs: FoundRun[];
  /** Each run's turn whose unit still runs. */
  running: Map<string, number>;
}

/** Where a run's streams and prompts are. */
export const runsDir = (runtime: string): string => join(runtime, "dashi-agents");
export const unitOf = (run: string, turn: number): string => `dashi-task-${run}-${turn}.service`;
/** A turn's stream. */
export const streamOf = (runtime: string, run: string, turn: number): string => join(runsDir(runtime), run, `turn-${turn}.jsonl`);

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

/** The lines of a stream read whole, and its exit line's code. */
export function readStream(text: string): Pick<TurnRead, "lines" | "exit"> {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const exit = exitLine(line);
    if (exit) return { lines, exit };
    if (line.trim()) lines.push(line);
  }
  return { lines, exit: undefined };
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The tasks' units, as `systemctl --user list-units` lists them (records.ts `runningUnits` reads it). */
function listTaskUnits(): string {
  const listed = Bun.spawnSync(["systemctl", "--user", "list-units", "--plain", "--no-legend", "--all", "dashi-task-*"], { stdin: "ignore", stderr: "ignore" });
  return listed.success ? listed.stdout.toString() : "";
}

export function systemdRunner(options: { runtime: string; bun: string; task: string; listUnits?: () => string }): TaskRunner {
  const dirOf = (run: string) => join(runsDir(options.runtime), run);
  const filesOf = (run: string, turn: number) => ({ stream: streamOf(options.runtime, run, turn), prompt: join(dirOf(run), `turn-${turn}.prompt`) });
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
    save(record) {
      // Whole or not at all: written beside, then moved over the old one.
      const path = join(dirOf(record.id), "run.json");
      try {
        writeFileSync(`${path}.new`, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        renameSync(`${path}.new`, path);
      } catch (error) {
        console.error(`dashi-shell: couldn't keep run ${record.id}'s record:`, error);
      }
    },
    readErrors(run, turn) {
      return lastErrors(readText(`${filesOf(run, turn).stream}.err`) ?? "");
    },
    readTurn(run, turn) {
      const { stream } = filesOf(run, turn);
      const text = readText(stream);
      if (text === null) return null;
      return { ...readStream(text), changed: statSync(stream).mtimeMs };
    },
    found() {
      // The units first, so a run that ends meanwhile reads as ended from its stream.
      const running = runningUnits((options.listUnits ?? listTaskUnits)());
      let names: string[] = [];
      try {
        names = readdirSync(runsDir(options.runtime));
      } catch {
        return { runs: [], running };
      }
      const runs = names.filter(isRunId).flatMap((id): FoundRun[] => {
        const dir = dirOf(id);
        const turns = (() => {
          try {
            return readdirSync(dir).flatMap((name) => {
              const found = /^turn-(\d{1,4})\.jsonl$/.exec(name);
              return found ? [Number(found[1])] : [];
            });
          } catch {
            return [];
          }
        })();
        if (turns.length === 0) return [];
        const prompt = join(dir, "turn-1.prompt");
        const record = readText(join(dir, "run.json"));
        return [
          {
            id,
            record: record === null ? null : parseRecord(record),
            turn: Math.max(...turns),
            prompt: readText(prompt) ?? "",
            promptAt: existsSync(prompt) ? statSync(prompt).mtimeMs : 0,
          },
        ];
      });
      return { runs, running };
    },
  };
}
