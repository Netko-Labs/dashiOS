/**
 * What runs in a terminal's window (boot/dictation.ts; research 1.11): a
 * bare shell, where words are a command, or an agent's prompt (Claude Code,
 * Codex), where they are prose. Told from the processes under the window's
 * own, read from /proc: nothing is asked of the terminal.
 */

import { readdirSync, readFileSync } from "node:fs";

/** Programs whose prompt takes prose, by the name the kernel knows them by. */
export const AGENT_PROGRAMS: readonly string[] = ["claude", "codex", "aider", "opencode", "gemini", "goose", "amp", "crush"];

export interface Process {
  pid: number;
  parent: number;
  name: string;
  /** Its command line's words (an agent that runs under node or bun is named there). */
  args: readonly string[];
}

/** One process from its /proc files; null when it is gone or unreadable. */
function readProcess(pid: number): Process | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // "pid (name with spaces) state ppid …": the name ends at the last parenthesis.
    const close = stat.lastIndexOf(")");
    const name = stat.slice(stat.indexOf("(") + 1, close);
    const parent = Number(stat.slice(close + 2).split(" ")[1]);
    const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).slice(0, 3);
    return Number.isInteger(parent) ? { pid, parent, name, args } : null;
  } catch {
    return null;
  }
}

export function processes(): Process[] {
  try {
    return readdirSync("/proc")
      .filter((entry) => /^\d+$/.test(entry))
      .map((entry) => readProcess(Number(entry)))
      .filter((each): each is Process => each !== null);
  } catch {
    return [];
  }
}

const base = (path: string): string => path.slice(path.lastIndexOf("/") + 1).toLowerCase();

const isAgent = (process: Process): boolean =>
  AGENT_PROGRAMS.includes(process.name.toLowerCase()) || process.args.some((arg) => AGENT_PROGRAMS.includes(base(arg)));

/** Whether an agent's program runs under `pid` (a terminal's own process), among `all`. */
export function agentUnder(pid: number, all: readonly Process[] = processes()): boolean {
  const children = new Map<number, Process[]>();
  for (const each of all) children.set(each.parent, [...(children.get(each.parent) ?? []), each]);
  const queue = [pid];
  const seen = new Set<number>();
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of children.get(next) ?? []) {
      if (isAgent(child)) return true;
      queue.push(child.pid);
    }
  }
  return false;
}
