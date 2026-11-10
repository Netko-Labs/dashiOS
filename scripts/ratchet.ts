// The ratchet every hard-rule check shares (docs/conventions.md, "Hard rules").
//
// A check finds today's offences as `key -> count` (a file and its line count,
// a file and how many casts it holds). Its list file in scripts/lists/ holds the
// offenders the repository started with. The check fails when:
//   - a key offends that is not on the list (a new offender),
//   - a listed key's count went up (it grew),
//   - a listed key no longer offends, or its count went down (trim the list).
// So the lists can only shrink. `--shrink` rewrites them to today's counts, but
// never adds a key or raises a count.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT: string = join(import.meta.dir, "..");
const LISTS = join(ROOT, "scripts", "lists");

export type Counts = Map<string, number>;

export interface Outcome {
  /** The list's name, e.g. "long-files". */
  name: string;
  problems: string[];
  /** How many entries the list holds after this run. */
  listed: number;
}

const shrinking = (): boolean => process.argv.includes("--shrink");

export function listPath(name: string): string {
  return join(LISTS, `${name}.txt`);
}

/** Read a list: `count<TAB>key` lines; `#` starts a comment. */
export function readList(name: string): { header: string[]; entries: Counts } {
  const path = listPath(name);
  const header: string[] = [];
  const entries: Counts = new Map();
  if (!existsSync(path)) return { header, entries };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("#")) {
      header.push(line);
      continue;
    }
    if (line.trim() === "") continue;
    const tab = line.indexOf("\t");
    const count = Number(line.slice(0, tab));
    if (tab < 0 || !Number.isInteger(count)) throw new Error(`${path}: bad line ${JSON.stringify(line)}`);
    entries.set(line.slice(tab + 1), count);
  }
  return { header, entries };
}

export function writeList(name: string, header: string[], entries: Counts): void {
  const keys = [...entries.keys()].sort();
  const body = keys.map((key) => `${entries.get(key)}\t${key}`);
  writeFileSync(listPath(name), `${[...header, ...body].join("\n")}\n`);
}

/** Compare today's offences with the list; with --shrink, tighten the list first. */
export function ratchet(name: string, found: Counts, what: string): Outcome {
  const { header, entries } = readList(name);
  if (shrinking()) {
    const tightened: Counts = new Map();
    for (const [key, count] of entries) {
      const now = found.get(key);
      if (now !== undefined) tightened.set(key, Math.min(count, now));
    }
    if (tightened.size !== entries.size || [...tightened].some(([key, count]) => entries.get(key) !== count)) {
      writeList(name, header, tightened);
    }
    entries.clear();
    for (const [key, count] of tightened) entries.set(key, count);
  }
  const problems: string[] = [];
  for (const [key, count] of [...found].sort()) {
    const listed = entries.get(key);
    if (listed === undefined) problems.push(`${key}: ${what} (${count}); new offenders are not allowed`);
    else if (count > listed) problems.push(`${key}: ${what} grew from ${listed} to ${count}`);
  }
  for (const [key, listed] of entries) {
    const now = found.get(key);
    if (now === undefined) problems.push(`${key}: no longer offends; remove it from scripts/lists/${name}.txt (or run with --shrink)`);
    else if (now < listed) problems.push(`${key}: down from ${listed} to ${now}; lower it in scripts/lists/${name}.txt (or run with --shrink)`);
  }
  return { name, problems, listed: entries.size };
}

/** Print outcomes and exit 1 if any failed. */
export function report(title: string, outcomes: Outcome[]): void {
  let failed = false;
  for (const outcome of outcomes) {
    if (outcome.problems.length === 0) {
      console.log(`${title}: ${outcome.name} ok (${outcome.listed} listed)`);
      continue;
    }
    failed = true;
    console.error(`${title}: ${outcome.name} FAILED`);
    for (const problem of outcome.problems) console.error(`  ${problem}`);
  }
  if (failed) process.exit(1);
}

/** Tracked and new (not ignored) files that exist, relative to the root. */
export function repoFiles(): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT });
  if (listed.exitCode !== 0) throw new Error(`git ls-files: ${listed.stderr.toString()}`);
  const files = listed.stdout.toString().split("\0").filter(Boolean);
  return [...new Set(files)].filter((file) => existsSync(join(ROOT, file))).sort();
}

export function isTest(file: string): boolean {
  return /(^|\/)(test|tests)\//.test(file) || /\.test\.tsx?$/.test(file);
}

export function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}
