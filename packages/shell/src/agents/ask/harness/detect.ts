/**
 * Finding the harnesses (catalog.ts): on PATH or where their installers put
 * them, what of an install under the home folder its sandbox needs to read
 * (the program, a Node package's folder, the interpreter a script names),
 * and whether it is signed in, without a model call. Pure where it can be:
 * the file system comes in through `Files`.
 */

import { accessSync, closeSync, constants, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { HarnessId } from "../answerer.ts";
import type { HarnessSpec } from "./catalog.ts";

export interface Files {
  /** Whether `path` is a file this user may run. */
  isExecutable(path: string): boolean;
  /** `path` with its links followed; null when it isn't there. */
  real(path: string): string | null;
  exists(path: string): boolean;
  /** The first bytes of a file (its `#!` line), or null. */
  head(path: string): string | null;
}

export const hostFiles: Files = {
  isExecutable(path) {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  real(path) {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  },
  exists: existsSync,
  head(path) {
    let fd: number | null = null;
    try {
      fd = openSync(path, "r");
      const buffer = new Uint8Array(256);
      const read = readSync(fd, buffer, 0, buffer.length, 0);
      return new TextDecoder().decode(buffer.subarray(0, read));
    } catch {
      return null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  },
};

/** A harness found. */
export interface FoundHarness {
  /** Where it was found (PATH, or an installer's folder). */
  path: string;
  /** The program itself, links followed: what the sandbox runs. */
  program: string;
  /** What of the home folder the sandbox needs to read to run it (empty for an install outside it). */
  readOnly: string[];
}

const inside = (path: string, dir: string): boolean => {
  const rel = relative(dir, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** `name` in the folders of PATH, then in `dirs`: the first that runs. */
export function which(name: string, path: string | undefined, dirs: readonly string[], files: Files): string | null {
  const candidates = [...(path ?? "").split(":").filter((dir) => isAbsolute(dir)), ...dirs].map((dir) => join(dir, name));
  return candidates.find((candidate) => files.isExecutable(candidate)) ?? null;
}

/** The Node package a file is in (its nearest folder with a package.json, below `home`); null when it isn't in one. */
function packageRoot(file: string, home: string, files: Files): string | null {
  for (let dir = dirname(file); inside(dir, home); dir = dirname(dir)) if (files.exists(join(dir, "package.json"))) return dir;
  return null;
}

/** The interpreter a script's `#!` line names, found; null for a binary or one it can't find. */
function interpreter(program: string, path: string | undefined, files: Files): string | null {
  const head = files.head(program);
  if (!head?.startsWith("#!")) return null;
  const words = (head.slice(2).split("\n")[0] ?? "").trim().split(/\s+/);
  const [first, second] = words;
  if (!first) return null;
  const named = first.endsWith("/env") ? (words.find((word, index) => index > 0 && !word.startsWith("-")) ?? second ?? null) : first;
  if (!named) return null;
  return isAbsolute(named) ? named : which(named, path, [], files);
}

/**
 * What of an install under `home` the sandbox reads: a single program; a
 * script's Node package (its folder with package.json); and the
 * interpreter it names, with that interpreter's install (`<prefix>/bin/node`
 * brings `<prefix>`).
 */
export function installReads(program: string, home: string, path: string | undefined, files: Files): string[] {
  const reads = new Set<string>();
  if (inside(program, home)) reads.add(packageRoot(program, home, files) ?? program);
  const found = interpreter(program, path, files);
  const real = found ? files.real(found) : null;
  if (real && inside(real, home)) {
    const prefix = dirname(dirname(real));
    reads.add(inside(prefix, home) && prefix !== home ? prefix : real);
  }
  return [...reads];
}

/** Where `spec` is installed, or null. */
export function findHarness(spec: HarnessSpec, home: string, path: string | undefined, files: Files = hostFiles): FoundHarness | null {
  const found = which(
    spec.binary,
    path,
    spec.dirs.map((dir) => join(home, dir)),
    files,
  );
  if (!found) return null;
  const program = files.real(found) ?? found;
  return { path: found, program, readOnly: installReads(program, home, path, files) };
}

/** A harness on its row: installed or not, and whether it is signed in (null: can't tell cheaply). */
export interface HarnessStatus {
  id: HarnessId;
  installed: boolean;
  signedIn: boolean | null;
}

/** Runs a program briefly and gives its output and exit code (code null when it couldn't run or took too long). */
export type Probe = (argv: readonly string[]) => Promise<{ stdout: string; code: number | null }>;

const PROBE_MS = 3_000;

export const hostProbe: Probe = async (argv) => {
  try {
    const child = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore", env: { ...process.env, NO_COLOR: "1" } });
    const timer = setTimeout(() => child.kill(), PROBE_MS);
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    clearTimeout(timer);
    return { stdout, code: child.signalCode ? null : code };
  } catch {
    return { stdout: "", code: null };
  }
};

/** Whether a found harness is signed in: its own status command, or its login file; never a model call. */
export async function signedIn(
  spec: HarnessSpec,
  found: FoundHarness,
  home: string,
  env: Readonly<Record<string, string | undefined>>,
  probe: Probe = hostProbe,
  readText: (path: string) => string | null = (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
): Promise<boolean | null> {
  const check = spec.signedIn;
  if (check.kind === "file") {
    const text = readText(check.path(home, env));
    return text === null ? null : check.read(text);
  }
  const { stdout, code } = await probe([found.path, ...check.args]);
  return check.read(stdout, code);
}

/** Every harness's row, in the catalog's order: installed or not, and signed in where that is cheap to tell. */
export async function harnessStatuses(
  specs: readonly HarnessSpec[],
  env: Readonly<Record<string, string | undefined>>,
  files: Files = hostFiles,
  probe: Probe = hostProbe,
): Promise<HarnessStatus[]> {
  const home = env.HOME ?? "";
  return Promise.all(
    specs.map(async (spec): Promise<HarnessStatus> => {
      const found = home ? findHarness(spec, home, env.PATH, files) : null;
      if (!found) return { id: spec.id, installed: false, signedIn: null };
      return { id: spec.id, installed: true, signedIn: await signedIn(spec, found, home, env, probe).catch(() => null) };
    }),
  );
}

/** The words a path is shown in, with `~` for the home folder. */
export const homeWords = (path: string, home: string): string => (inside(path, home) ? `~${sep}${relative(home, path)}` : path);
