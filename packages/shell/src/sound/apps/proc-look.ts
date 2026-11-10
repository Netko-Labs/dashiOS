/**
 * A process's facts for identity.ts, read from /proc (read only): its
 * kernel name and parent from `stat`, its command line, its cgroup.
 */

import { readFileSync } from "node:fs";
import { parseCmdline } from "../../shared/processes/index.ts";
import type { ProcessLook } from "./identity.ts";

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** `pid (comm) state ppid …`: the name may hold spaces and parentheses, so it ends at the last ")". */
export function parseStatLine(stat: string): { comm: string; ppid: number } | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const ppid = Number(stat.slice(close + 2).split(" ")[1]);
  return Number.isSafeInteger(ppid) ? { comm: stat.slice(open + 1, close), ppid } : null;
}

export function readProcess(pid: number, root = "/proc"): ProcessLook | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const stat = read(`${root}/${pid}/stat`);
  const parsed = stat === null ? null : parseStatLine(stat);
  if (!parsed) return null;
  return { ...parsed, argv: parseCmdline(read(`${root}/${pid}/cmdline`)), cgroup: read(`${root}/${pid}/cgroup`) ?? "" };
}
