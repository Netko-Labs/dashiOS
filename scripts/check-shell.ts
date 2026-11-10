#!/usr/bin/env bun
// H13 (docs/conventions.md, "Hard rules"): every shell script parses with
// `bash -n` (sh scripts too: sh's POSIX mode hides quoting bugs) and passes
// shellcheck. Scripts are found by
// their `#!` line, since most have no extension. Ratchets on two lists in
// scripts/lists/ (see scripts/ratchet.ts):
//   shell-parse   scripts that do not parse (count 1)
//   shellcheck    shellcheck findings per script, at every severity
// Run: bun scripts/check-shell.ts [--shrink]

import { closeSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { type Counts, type Outcome, ROOT, ratchet, repoFiles, report } from "./ratchet.ts";

const SHEBANG = /^#!.*(?:\/|env\s+)(sh|bash|dash)(?:\s|$)/;

function firstLine(file: string): string {
  const fd = openSync(join(ROOT, file), "r");
  try {
    const buffer = Buffer.alloc(128);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString("latin1").split("\n")[0] ?? "";
  } finally {
    closeSync(fd);
  }
}

/** Shell scripts in the repository and the shell each names. */
export function shellScripts(files: string[]): Map<string, string> {
  const scripts = new Map<string, string>();
  for (const file of files) {
    const shell = SHEBANG.exec(firstLine(file))?.[1];
    if (shell) scripts.set(file, shell === "bash" ? "bash" : "sh");
  }
  return scripts;
}

export function parseFailures(scripts: Map<string, string>): Counts {
  const found: Counts = new Map();
  for (const file of scripts.keys()) {
    const run = Bun.spawnSync(["bash", "-n", file], { cwd: ROOT, stderr: "pipe" });
    if (run.exitCode !== 0) found.set(file, 1);
  }
  return found;
}

export function shellcheckFindings(scripts: Map<string, string>): Counts {
  const found: Counts = new Map();
  if (scripts.size === 0) return found;
  const run = Bun.spawnSync(["shellcheck", "--format=json1", "--severity=style", ...scripts.keys()], { cwd: ROOT });
  if (run.exitCode !== 0 && run.exitCode !== 1) throw new Error(`shellcheck failed: ${run.stderr.toString()}`);
  const out = JSON.parse(run.stdout.toString()) as { comments: { file: string }[] };
  for (const comment of out.comments) found.set(comment.file, (found.get(comment.file) ?? 0) + 1);
  return found;
}

export function checkShell(files: string[]): Outcome[] {
  const scripts = shellScripts(files);
  return [ratchet("shell-parse", parseFailures(scripts), "does not parse"), ratchet("shellcheck", shellcheckFindings(scripts), "shellcheck findings")];
}

if (import.meta.main) report("check-shell", checkShell(repoFiles()));
