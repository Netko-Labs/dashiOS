/**
 * What dnf's own cache says, read as the user with no network
 * (`dnf5 repoquery --cacheonly`, about 0.3 s for every package of every
 * repository): the repositories, every package available (name, repository,
 * version, arch, summary) and which of them are apps (`application()`
 * provides, with their desktop files). Commands are argument lists; output is
 * split on separators no package field can hold.
 */

import { isRecord } from "@dashi/shape";
import type { Repo } from "../sources.ts";

/** Between fields, and after a record (dnf's own newlines sit inside `%{provides}`). */
export const FIELD = "\x1f";
export const RECORD = "\x1e";

export const repoListCommand = (): string[] => ["dnf5", "repo", "list", "--all", "--json"];

export const packagesCommand = (): string[] => [
  "dnf5",
  "repoquery",
  "--cacheonly",
  "--quiet",
  "--available",
  `--qf=%{name}${FIELD}%{repoid}${FIELD}%{evr}${FIELD}%{arch}${FIELD}%{summary}${RECORD}\n`,
];

export const appsCommand = (): string[] => [
  "dnf5",
  "repoquery",
  "--cacheonly",
  "--quiet",
  "--available",
  "--latest-limit=1",
  "--whatprovides=application()",
  `--qf=%{name}${FIELD}%{repoid}${FIELD}%{provides}${RECORD}\n`,
];

export const installedCommand = (): string[] => [
  "dnf5",
  "repoquery",
  "--quiet",
  "--installed",
  `--qf=%{name}${FIELD}%{from_repo}${FIELD}%{installtime}${FIELD}%{reason}${RECORD}\n`,
];

export interface RpmPackage {
  name: string;
  repoId: string;
  /** `[epoch:]version-release`. */
  evr: string;
  arch: string;
  summary: string;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/;
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,199}$/;
const EVR = /^[A-Za-z0-9._:+~^-]{1,80}$/;

export const isPackageName = (value: string): boolean => NAME.test(value);
export const isRepoId = (value: string): boolean => REPO_ID.test(value);

/** Packages nobody looks for by hand: debug symbols, sources, headers, translations. */
const SIDE_PACKAGE =
  /-(debuginfo|debugsource|devel|static|doc|docs|javadoc|tests?|libs)$|-langpack-|^(texlive|perl|python3|golang|ghc|nodejs|php|R|ocaml|mingw\d*)-/;

function records(output: string): string[][] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\n/, "").split(FIELD))
    .filter((fields) => fields.length > 1);
}

/** Every package for this machine (its arch or noarch), one per name and repository, side packages left out. */
export function parsePackages(output: string, arch: string): RpmPackage[] {
  const out: RpmPackage[] = [];
  const seen = new Set<string>();
  for (const [name = "", repoId = "", evr = "", pkgArch = "", summary = ""] of records(output)) {
    if (!NAME.test(name) || !REPO_ID.test(repoId) || !EVR.test(evr)) continue;
    if (pkgArch !== arch && pkgArch !== "noarch") continue;
    if (SIDE_PACKAGE.test(name)) continue;
    const key = `${name}@${repoId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, repoId, evr, arch: pkgArch, summary: summary.replace(/\s+/g, " ").trim().slice(0, 160) });
  }
  return out;
}

export interface RpmApp {
  name: string;
  repoId: string;
  /** Its desktop files, without `.desktop`. */
  desktopIds: string[];
}

/** The packages that are apps, with the desktop files they install (`application(org.gimp.GIMP.desktop)`). */
export function parseApps(output: string): RpmApp[] {
  const out: RpmApp[] = [];
  for (const [name = "", repoId = "", provides = ""] of records(output)) {
    if (!NAME.test(name) || !REPO_ID.test(repoId)) continue;
    const desktopIds = [...provides.matchAll(/application\(([A-Za-z0-9._-]{1,160})\.desktop\)/g)].map((match) => match[1] ?? "").filter(Boolean);
    if (desktopIds.length > 0) out.push({ name, repoId, desktopIds: desktopIds.slice(0, 8) });
  }
  return out;
}

/** Why dnf says a package is here: one it brought for another (a library, a plugin) rather than one asked for. */
const BROUGHT = new Set(["Dependency", "Weak Dependency"]);

/**
 * What is installed: name to the repository it came from (`fedora`, or `@commandline` for a file), when (Unix seconds),
 * and the ones dnf installed only because another package needed them (`dependencies`: its reason is "Dependency" or
 * "Weak Dependency"; "User", "Group", "External" and an unknown reason are the person's).
 */
export function parseInstalled(output: string): { from: Map<string, string>; at: Map<string, number>; dependencies: Set<string> } {
  const from = new Map<string, string>();
  const at = new Map<string, number>();
  const dependencies = new Set<string>();
  for (const [name = "", repo = "", time = "", reason = ""] of records(output)) {
    if (!NAME.test(name)) continue;
    from.set(name, repo.trim().slice(0, 200) || "@System");
    const seconds = Number(time.trim());
    if (Number.isFinite(seconds) && seconds > 0) at.set(name, seconds);
    if (BROUGHT.has(reason.trim())) dependencies.add(name);
  }
  return { from, at, dependencies };
}

/** `dnf5 repo list --all --json`: every repository, on or off. A bad entry is left out. */
export function parseRepoList(output: string): Repo[] {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const repos: Repo[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { id, name, is_enabled: enabled } = entry;
    if (typeof id !== "string" || !REPO_ID.test(id) || typeof enabled !== "boolean") continue;
    repos.push({ id, name: typeof name === "string" ? name.slice(0, 120) : id, enabled });
  }
  return repos;
}

/** The system's first transaction: what the image (or the installer) put on the computer. */
export const firstTransactionCommand = (): string[] => ["dnf5", "history", "info", "1", "--json"];

/** The package names in a transaction's JSON (`"nevra":"firefox-0:160.0-1.fc44.x86_64"` → `firefox`); a bad entry is skipped. */
export function parseTransactionNames(output: string): Set<string> {
  const names = new Set<string>();
  for (const match of output.matchAll(/"nevra"\s*:\s*"([^"]{1,300})"/g)) {
    const name = (match[1] ?? "").replace(/-\d+:[^-]+-[^-]+$/, "");
    if (NAME.test(name)) names.add(name);
  }
  return names;
}
