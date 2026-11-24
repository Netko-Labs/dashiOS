/**
 * A harness's version, asked of the program itself (`--version`) when its
 * command line depends on it (spec.ts `versioned`: OpenCode, opencode.ts).
 *
 * Asked before a turn, never at the shell's start, and once per program:
 * the answer is kept by the program's path and its file (modified time,
 * size and inode: OpenCode's installer gives every release the same
 * modified time), so an update is asked again. A program that doesn't
 * answer in time (detect.ts `hostProbe`, 3 s) is unknown, and asked again
 * next turn.
 */

import { statSync } from "node:fs";
import { type FoundHarness, hostProbe, type Probe } from "./detect.ts";
import type { HarnessSpec } from "./spec.ts";

/** What a program's file is now, to tell an update; null when it can't be read (nothing is kept then). */
export type FileIdentity = (path: string) => string | null;

const hostIdentity: FileIdentity = (path) => {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return null;
  }
};

/** The version in what a program printed ("opencode v2.4.1" → "2.4.1"); null when there is none. */
export function versionWords(stdout: string): string | null {
  return /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?/.exec(stdout)?.[0] ?? null;
}

/** A version's first number ("2.4.1" → 2); null when it can't be told. */
export function majorVersion(version: string | null | undefined): number | null {
  const major = /^(\d+)\./.exec(version ?? "")?.[1];
  return major === undefined ? null : Number(major);
}

const known = new Map<string, { identity: string; version: Promise<string | null> }>();

/** The version `program` says it is, asked once for each file it is (see above). */
export function programVersion(program: string, probe: Probe = hostProbe, identity: FileIdentity = hostIdentity): Promise<string | null> {
  const file = identity(program);
  const kept = known.get(program);
  if (file !== null && kept?.identity === file) return kept.version;
  const version = probe([program, "--version"])
    .then(({ stdout, code }) => (code === 0 ? versionWords(stdout) : null))
    .catch(() => null);
  if (file !== null) {
    known.set(program, { identity: file, version });
    // Unknown (it didn't answer, or not in time): asked again next turn.
    void version.then((said) => {
      if (said === null && known.get(program)?.version === version) known.delete(program);
    });
  }
  return version;
}

/** The version a turn of `spec` is built for: asked of the program found only when its command line depends on it. */
export function turnVersion(spec: Pick<HarnessSpec, "versioned">, found: Pick<FoundHarness, "program">, probe?: Probe): Promise<string | null> {
  return spec.versioned ? programVersion(found.program, probe) : Promise.resolve(null);
}
