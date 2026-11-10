/**
 * What an agent may do with files, decided here and nowhere else. An agent
 * names paths as text, which is untrusted: a path must be absolute (or `~/…`),
 * is resolved through symbolic links (`realpath`), and must end up inside the
 * person's home folder or a removable drive's mount, and outside the folders
 * that hold secrets and Dashi's own state. Only listing, searching, opening
 * (in the default app, on screen), and moving to the Trash exist: there is no
 * tool that reads a file's content, writes, or deletes for good.
 */

import { lstat, realpath, stat } from "node:fs/promises";
import { type Exec, exec } from "./exec.ts";
import { type FileItem, readFolder } from "./items.ts";
import { type MimeIndex, mimeOf } from "./mime.ts";
import { mayOpen, openDefault } from "./open.ts";
import type { OpContext } from "./ops.ts";
import { baseName, expandHome, isInside, normalizePath, parentOf, tilde } from "./paths.ts";
import { searchComputer, searchFolder } from "./search.ts";
import { protectedReason, trashPaths } from "./trashops.ts";

export interface AgentPolicy {
  home: string;
  user: string;
  /** Standard folders, which can't be trashed. */
  userDirs: readonly string[];
}

/** Folders under home whose names, contents, and presence are not an agent's business. */
export const OFF_LIMITS = [
  ".ssh",
  ".gnupg",
  ".password-store",
  ".aws",
  ".kube",
  ".local/share/keyrings",
  ".local/state/dashi",
  ".config/dashi",
  ".config/1Password",
] as const;

const PATH_MAX = 4096;

/** Where an agent may look: the home folder and removable drives' mounts. */
export const allowedRoots = (policy: AgentPolicy): string[] => [policy.home, `/run/media/${policy.user}`, `/media/${policy.user}`];

export type Resolved = { ok: true; path: string } | { ok: false; error: string };

/** The real path an agent's `path` stands for, or why it can't be used. */
export async function resolveForAgent(input: unknown, policy: AgentPolicy): Promise<Resolved> {
  if (typeof input !== "string" || input === "" || input.length > PATH_MAX)
    return { ok: false, error: "`path` must be an absolute path, like /home/me/Documents, on one line." };
  if (/[\0-\x1f\x7f]/.test(input)) return { ok: false, error: "`path` must be on one line, with no control characters." };
  const normalized = normalizePath(expandHome(input, policy.home));
  if (normalized === null) return { ok: false, error: "`path` must be absolute: start with / or ~." };
  let real: string;
  try {
    real = await realpath(normalized);
  } catch {
    return { ok: false, error: "There is nothing at that path, or it can't be read." };
  }
  const roots = await Promise.all(allowedRoots(policy).map((root) => realpath(root).catch(() => root)));
  if (!roots.some((root) => isInside(root, real))) {
    return { ok: false, error: `Files here are limited to your home folder (${tilde(policy.home, policy.home)}) and removable drives.` };
  }
  const home = roots[0] as string;
  if (OFF_LIMITS.some((part) => isInside(`${home}/${part}`, real) || isInside(`${home}/${part}`, normalized))) {
    return { ok: false, error: "That folder holds secrets or the desktop's own state, and isn't available to agents." };
  }
  return { ok: true, path: real };
}

/** Whether a path found by a search may be shown (the same rules, without touching the disk). */
export function mayShow(path: string, policy: AgentPolicy): boolean {
  const clean = normalizePath(path);
  if (clean === null) return false;
  if (!allowedRoots(policy).some((root) => isInside(root, clean))) return false;
  return !OFF_LIMITS.some((part) => isInside(`${policy.home}/${part}`, clean));
}

/** An item as an agent is told it. */
export interface ItemView {
  name: string;
  kind: string;
  size?: number;
  modified: string;
  hidden?: boolean;
  mime: string;
  folder: string;
}

/** How an item is told to the agent. Names are other people's text: the tool descriptions say so. */
export function describeItem(item: FileItem, home: string): ItemView {
  return {
    name: item.name,
    kind: item.broken ? "broken_link" : item.isLink ? `link_to_${item.kind}` : item.kind,
    ...(item.kind === "file" ? { size: item.size } : {}),
    modified: new Date(item.mtime).toISOString(),
    ...(item.hidden ? { hidden: true } : {}),
    mime: item.mime,
    ...(item.where !== undefined ? { folder: item.where } : { folder: tilde(parentOf(item.path), home) }),
  };
}

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

export interface Deps {
  policy: AgentPolicy;
  index: MimeIndex;
  run?: Exec;
}

export async function listFolder(
  path: string,
  options: { hidden: boolean; limit: number },
  deps: Deps,
): Promise<{ error: string } | { path: string; entries: ReturnType<typeof describeItem>[]; total: number }> {
  const resolved = await resolveForAgent(path, deps.policy);
  if (!resolved.ok) return { error: resolved.error };
  const info = await stat(resolved.path).catch(() => null);
  if (!info?.isDirectory()) return { error: "That path isn’t a folder." };
  const listing = await readFolder(resolved.path, deps.index);
  if (listing.error) return { error: listing.error };
  const shown = listing.items
    .filter((item) => options.hidden || !item.hidden)
    // The off-limits folders don't appear even when their parent is listed.
    .filter((item) => mayShow(item.path, deps.policy))
    .sort(
      (a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  return { path: resolved.path, entries: shown.slice(0, options.limit).map((item) => describeItem(item, deps.policy.home)), total: shown.length };
}

export async function searchFor(
  query: string,
  options: { folder: string | null; limit: number },
  deps: Deps,
): Promise<{ error: string } | { results: Array<ReturnType<typeof describeItem> & { path: string }>; total: number; truncated: boolean }> {
  const { policy, index } = deps;
  let items: FileItem[];
  let truncated = false;
  if (options.folder !== null) {
    const resolved = await resolveForAgent(options.folder, policy);
    if (!resolved.ok) return { error: resolved.error };
    const found = await searchFolder(resolved.path, query, { hidden: false, home: policy.home, index });
    items = found.items;
    truncated = found.truncated;
  } else {
    items = await searchComputer(query, policy.home, index, deps.run ?? exec, options.limit * 2);
  }
  const shown = items.filter((item) => mayShow(item.path, policy));
  return { results: shown.slice(0, options.limit).map((item) => ({ path: item.path, ...describeItem(item, policy.home) })), total: shown.length, truncated };
}

/** Opens a file or folder in the default app; an error to tell the agent, or what it was. */
/** `confirmed` is false when its app hadn't taken it yet when the wait ran out (it may still open). */
export async function openForAgent(path: string, deps: Deps): Promise<{ error: string } | { opened: string; kind: string; confirmed: boolean }> {
  const resolved = await resolveForAgent(path, deps.policy);
  if (!resolved.ok) return { error: resolved.error };
  const info = await stat(resolved.path).catch(() => null);
  if (!info) return { error: "That can’t be read." };
  const kind = info.isDirectory() ? "folder" : info.isFile() ? "file" : "other";
  const name = baseName(resolved.path);
  // The type comes from the name, as in the Files window, and the check is the one a click there makes: launchers and programs are never run.
  const check = mayOpen({ kind, name, mime: kind === "folder" ? "inode/directory" : mimeOf(deps.index, name) });
  if (!check.ok) return { error: check.reason ?? "That can’t be opened." };
  const outcome = await openDefault(resolved.path, deps.run ?? exec);
  if (outcome.kind === "failed") return { error: `It couldn’t be opened: ${outcome.problem}` };
  return { opened: resolved.path, kind, confirmed: outcome.kind === "opened" };
}

export interface TrashPlan {
  path: string;
  name: string;
  kind: "file" | "folder" | "other";
}

/**
 * What a trash request is about, checked before anyone is asked: an error, or
 * the item. The folder it is in is resolved and checked like any path; the
 * item itself is looked at with `lstat`, so a link is trashed as the link
 * (what `gio trash` does too) and not as whatever it points at.
 */
export async function planTrash(path: string, policy: AgentPolicy): Promise<{ error: string } | TrashPlan> {
  const normalized = typeof path === "string" && path.length <= PATH_MAX && !/[\0-\x1f\x7f]/.test(path) ? normalizePath(expandHome(path, policy.home)) : null;
  if (normalized === null || normalized === "/") return { error: "`path` must be an absolute path, like /home/me/old.txt." };
  const folder = await resolveForAgent(parentOf(normalized), policy);
  if (!folder.ok) return { error: folder.error };
  const target = `${folder.path === "/" ? "" : folder.path}/${baseName(normalized)}`;
  const info = await lstat(target).catch(() => null);
  if (!info) return { error: "There is nothing at that path." };
  if (!mayShow(target, policy)) return { error: "That isn’t available to agents." };
  const reason = protectedReason(target, policy.home, policy.userDirs);
  if (reason) return { error: reason };
  return { path: target, name: baseName(target), kind: info.isDirectory() ? "folder" : info.isFile() || info.isSymbolicLink() ? "file" : "other" };
}

/** Moves a planned item to the Trash (after the person said yes). */
export async function trashForAgent(plan: TrashPlan, ctx: OpContext, run: Exec = exec): Promise<string | null> {
  const result = await trashPaths([plan.path], ctx, run);
  return result.failed[0]?.reason ?? null;
}
