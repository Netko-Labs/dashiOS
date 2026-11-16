/**
 * Where an agent's path may lead, for the tools that read, write, move and
 * wait for files (agent-text.ts, agent-moves.ts): absolute (or `~/…`),
 * resolved through links, inside the home folder or a removable drive, and
 * never a secret place (secret-places.ts). Unlike `resolveForAgent` it also
 * places a path that doesn't exist yet: its folder must, and is resolved.
 */

import { lstat, realpath } from "node:fs/promises";
import type { AgentPolicy } from "./agent.ts";
import { allowedRoots } from "./agent.ts";
import { baseName, checkName, expandHome, isInside, normalizePath, parentOf, tilde } from "./paths.ts";
import { secretReason } from "./secret-places.ts";

const PATH_MAX = 4096;

export type Placed = { ok: true; path: string; exists: boolean; kind: "file" | "folder" | "link" | "other" | null } | { ok: false; error: string };

const kindOf = async (path: string): Promise<"file" | "folder" | "link" | "other" | null> => {
  const info = await lstat(path).catch(() => null);
  if (!info) return null;
  return info.isFile() ? "file" : info.isDirectory() ? "folder" : info.isSymbolicLink() ? "link" : "other";
};

/** The real place an agent's `path` stands for, existing or not (its folder must exist), or why it can't be used. */
export async function placeForAgent(input: unknown, policy: AgentPolicy): Promise<Placed> {
  if (typeof input !== "string" || input === "" || input.length > PATH_MAX) return { ok: false, error: "`path` must be an absolute path, on one line." };
  if (/[\0-\x1f\x7f]/.test(input)) return { ok: false, error: "`path` must be on one line, with no control characters." };
  const normalized = normalizePath(expandHome(input, policy.home));
  if (normalized === null || normalized === "/") return { ok: false, error: "`path` must be absolute: start with / or ~." };
  const exists = (await lstat(normalized).catch(() => null)) !== null;
  let real: string;
  if (exists) {
    real = await realpath(normalized).catch(() => normalized);
  } else {
    const name = baseName(normalized);
    const bad = checkName(name);
    if (bad) return { ok: false, error: bad };
    const folder = await realpath(parentOf(normalized)).catch(() => null);
    if (folder === null) return { ok: false, error: `There is no folder ${tilde(parentOf(normalized), policy.home)}.` };
    real = `${folder === "/" ? "" : folder}/${name}`;
  }
  const roots = await Promise.all(allowedRoots(policy).map((root) => realpath(root).catch(() => root)));
  if (!roots.some((root) => isInside(root, real) && root !== real))
    return { ok: false, error: `Files here are limited to your home folder (${tilde(policy.home, policy.home)}) and removable drives.` };
  const home = roots[0] ?? policy.home;
  const reason = secretReason(real, home) ?? secretReason(normalized, policy.home);
  if (reason) return { ok: false, error: reason };
  return { ok: true, path: real, exists, kind: exists ? await kindOf(real) : null };
}
