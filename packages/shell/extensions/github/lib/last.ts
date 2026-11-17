/**
 * The repository Create Issue filed in last, kept in the extension's own
 * home (its data folder, the one place its sandbox may write).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRepo } from "./api.ts";

const FILE = (): string => join(process.env.HOME || homedir(), "last-repository");

export function lastRepository(): string | null {
  try {
    const kept = readFileSync(FILE(), "utf8").trim();
    return isRepo(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function rememberRepository(repo: string): void {
  try {
    writeFileSync(FILE(), repo);
  } catch {}
}
