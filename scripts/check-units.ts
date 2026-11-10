#!/usr/bin/env bun
// H17 (docs/conventions.md, "Hard rules"): a system service Dashi ships scores
// 5.0 or better (lower is safer) on `systemd-analyze security --offline=true`.
// Units over 5.0 today are in scripts/lists/unit-exposure.txt, their score
// times ten as the ceiling; a ratchet (scripts/ratchet.ts), so a listed unit
// may not get worse, and a better score must be written down.
// Run: bun scripts/check-units.ts [--shrink]

import { type Counts, type Outcome, ROOT, ratchet, read, repoFiles, report } from "./ratchet.ts";

export const LIMIT = 5.0;
const SYSTEM_UNIT = /(^|\/)usr\/lib\/systemd\/system\/[^/]+\.service$/;

/** The exposure score systemd-analyze gives a unit file, e.g. 7.5. */
export function exposure(file: string): number {
  const run = Bun.spawnSync(["systemd-analyze", "security", "--offline=true", "--no-pager", file], { cwd: ROOT, stderr: "pipe" });
  const text = `${run.stdout.toString()}\n${run.stderr.toString()}`;
  const score = /Overall exposure level for \S+: (\d+(?:\.\d+)?)/.exec(text)?.[1];
  if (score === undefined) throw new Error(`systemd-analyze gave no score for ${file}:\n${text}`);
  return Number(score);
}

export function systemUnits(files: string[]): string[] {
  return files.filter((file) => SYSTEM_UNIT.test(file) && read(file).includes("[Service]"));
}

export function unitExposure(files: string[]): Counts {
  const found: Counts = new Map();
  for (const unit of systemUnits(files)) {
    const score = exposure(unit);
    if (score > LIMIT) found.set(unit, Math.round(score * 10));
  }
  return found;
}

export function checkUnits(files: string[]): Outcome[] {
  return [ratchet("unit-exposure", unitExposure(files), `exposure ×10 over ${LIMIT * 10}`)];
}

if (import.meta.main) report("check-units", checkUnits(repoFiles()));
