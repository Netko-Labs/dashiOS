/**
 * Who is on the other end of an agent's connection: the peer process from
 * SO_PEERCRED (libc's getsockopt through bun:ffi, on the Bun socket's fd),
 * then its ancestors in /proc. An agent connects through `dashi-mcp`, often
 * via a shell, so the agent is the first ancestor that is neither; an
 * `sshd` on the way means it is on another machine.
 *
 * An agent that is a script under an interpreter (Node, Bun, Python, …) is
 * told apart by its script, not by the interpreter's path (invocation.ts).
 *
 * This names agents for the person; it is not a boundary against programs
 * already running as the person (docs/agents.html, Safety).
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { closeSync, openSync, readFileSync, readlinkSync, readSync } from "node:fs";
import { basename } from "node:path";
import { findInvocation, type Interpreter, interpreterOf, invocationKey, invocationLabel, MAX_CMDLINE, parseCmdline } from "./invocation.ts";

const SOL_SOCKET = 1;
const SO_PEERCRED = 17;
/** How far up the process tree to look. */
const MAX_DEPTH = 16;

/** Processes between an agent and the socket, skipped when naming it. */
const GO_BETWEENS = new Set(["dashi-mcp", "sh", "bash", "zsh", "dash", "fish", "env", "socat", "nc", "ncat", "timeout"]);

let libc: { symbols: { getsockopt: (...args: unknown[]) => number } } | null = null;

/** The connecting process, if it runs as this user. */
export function peerPid(fd: number): number | null {
  try {
    libc ??= dlopen("libc.so.6", {
      getsockopt: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    }) as unknown as typeof libc;
  } catch {
    return null;
  }
  // struct ucred { pid_t pid; uid_t uid; gid_t gid; }
  const credentials = new Int32Array(3);
  const length = new Uint32Array([credentials.byteLength]);
  if (libc?.symbols.getsockopt(fd, SOL_SOCKET, SO_PEERCRED, ptr(credentials), ptr(length)) !== 0) return null;
  const [pid = 0, uid] = credentials;
  return uid === process.getuid?.() && pid > 0 ? pid : null;
}

/** A process's name and parent from `/proc/<pid>/stat`: "pid (comm) S ppid …".
 * The name may hold spaces and parentheses, so split at the last ')'. */
export function parseStat(stat: string): { comm: string; ppid: number } | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const [, ppid] = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const parent = Number(ppid);
  return Number.isInteger(parent) ? { comm: stat.slice(open + 1, close), ppid: parent } : null;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** `pid`, then its parents, up to init. */
export function* ancestry(pid: number): Generator<{ pid: number; comm: string }> {
  let current = pid;
  for (let depth = 0; depth < MAX_DEPTH && current > 1; depth++) {
    const stat = parseStat(read(`/proc/${current}/stat`) ?? "");
    if (!stat) return;
    yield { pid: current, comm: stat.comm };
    current = stat.ppid;
  }
}

export function descendsFrom(pid: number, ancestor: number): boolean {
  for (const entry of ancestry(pid)) if (entry.pid === ancestor) return true;
  return false;
}

export interface Peer {
  /** The agent's process name ("claude"), or "Remote agent". */
  name: string;
  /** Where it runs from, for the sheet ("~/.local/bin/claude"). */
  detail: string;
  /** What stored grants are keyed by: the executable's path, plus the script for an interpreter. */
  key: string;
  remote: boolean;
}

/** The first `max` bytes of a file, or null. */
function readBounded(path: string, max: number): Uint8Array | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = new Uint8Array(max);
    return buffer.subarray(0, readSync(fd, buffer, 0, max, 0));
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function cwdOf(pid: number): string | null {
  try {
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    return cwd.endsWith(" (deleted)") ? null : cwd;
  } catch {
    return null;
  }
}

/** What `pid` runs under `interpreter`; `fallbackCwd` stands in when its directory can't be read. */
function invocationOf(pid: number, interpreter: Interpreter, fallbackCwd: string | null = null) {
  const args = parseCmdline(readBounded(`/proc/${pid}/cmdline`, MAX_CMDLINE) ?? new Uint8Array());
  return args && findInvocation(interpreter, args, cwdOf(pid) ?? fallbackCwd);
}

/** A Bun or Node process running the bridge script counts as the bridge. */
function isBridge(pid: number, comm: string): boolean {
  const interpreter = interpreterOf(comm);
  if (interpreter?.family !== "bun" && interpreter?.family !== "node") return false;
  // Only the script's name matters here, so a directory that can't be read is no reason to miss it.
  const script = invocationOf(pid, interpreter, "/");
  return script?.kind === "file" && basename(script.path).replace(/\.ts$/, "") === "dashi-mcp";
}

function homeRelative(path: string): string {
  const home = process.env.HOME;
  return home && path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

/** An agent that is a script: named by the interpreter and what it runs. */
function interpreted(pid: number, comm: string, exe: string | null, interpreter: Interpreter): Peer {
  const program = exe ?? comm;
  const script = invocationOf(pid, interpreter);
  if (!script) {
    // Without a script the interpreter's path would stand for every program it
    // runs, so this connection is its own agent and nothing it is granted is
    // recognized again.
    return { name: comm, detail: `${basename(program)} (script unknown)`, key: `pid:${pid}`, remote: false };
  }
  return {
    name: comm,
    detail: `${basename(program)} ${invocationLabel(script, homeRelative)}`,
    key: invocationKey(program, script),
    remote: false,
  };
}

export function identify(pid: number): Peer {
  for (const { pid: ancestor, comm } of ancestry(pid)) {
    if (comm.startsWith("sshd")) return { name: "Remote agent", detail: "connected over SSH", key: "ssh", remote: true };
    if (GO_BETWEENS.has(comm) || isBridge(ancestor, comm)) continue;
    let exe: string | null = null;
    try {
      exe = readlinkSync(`/proc/${ancestor}/exe`);
    } catch {
      // Gone, or not ours to read: the name alone will do.
    }
    const interpreter = interpreterOf(exe ?? comm);
    if (interpreter) return interpreted(ancestor, comm, exe, interpreter);
    return { name: comm, detail: exe ? homeRelative(exe) : comm, key: exe ?? comm, remote: false };
  }
  return { name: "Unknown agent", detail: `process ${pid}`, key: `pid:${pid}`, remote: false };
}

/** Grants for remote agents are keyed by the name they claim. */
export function grantKey(peer: Peer, claims: string | null): string {
  return peer.remote ? `ssh:${claims ?? "unknown"}` : peer.key;
}
