// Where did a file go? The list files (scripts/lists/) are keyed by path, so a file moved with
// `git mv` would look like "no longer offends" plus a new offender. This reads git's rename
// detection so the lists can follow the file: see list-rename.ts and ratchet.ts's --shrink.

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT: string = join(import.meta.dir, "..");
const HISTORY = 2000;

/** Parse `git … --name-status` output: `R100<TAB>old<TAB>new` lines become old -> new. */
export function parseRenames(text: string): Map<string, string> {
  const moved = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) moved.set(from, to);
  }
  return moved;
}

function git(args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return run.exitCode === 0 ? run.stdout.toString() : "";
}

/**
 * Every rename git can see: staged or not yet committed (against HEAD), then committed ones in the
 * last commits, oldest first, so a chain a -> b -> c resolves with `follow`.
 */
export function gitRenames(): Map<string, string> {
  cached ??= readGitRenames();
  return cached;
}

let cached: Map<string, string> | undefined;

function readGitRenames(): Map<string, string> {
  const moved = new Map<string, string>();
  const history = git(["log", "-M", "--diff-filter=R", "--name-status", "--format=", `-n${HISTORY}`]);
  const commits = history.split("\n").reverse();
  for (const [from, to] of parseRenames(commits.join("\n"))) moved.set(from, to);
  for (const [from, to] of parseRenames(git(["diff", "-M", "--name-status", "HEAD"]))) moved.set(from, to);
  return moved;
}

/** The path a file has now: follow old -> new until a path that exists (or is not renamed). */
export function follow(path: string, moved: Map<string, string>, exists: (path: string) => boolean = (p) => existsSync(join(ROOT, p))): string {
  let now = path;
  for (let hops = 0; hops < 50 && !exists(now); hops++) {
    const next = moved.get(now);
    if (next === undefined) break;
    now = next;
  }
  return now;
}
