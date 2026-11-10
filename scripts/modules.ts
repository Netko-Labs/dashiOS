// What a module is, and who imports what (docs/conventions.md, "`lib/` And `shared/`").
// scripts/check-modules.ts holds H18 to H20 to it; scripts/module-map.ts prints the map.
//
// A module is a folder with one public surface:
//   - a folder under packages/shell/src/ (not shared/ itself), and each concern under src/shared/;
//   - an app under packages/shell/apps/ (the kit too);
//   - a folder under another package's src/.
// Inside one, a folder with its own index.ts(x) is a nested module (not inside a lib/).
// A file outside every module folder (packages/shell/src/apps.ts) is a module of one file.

import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { specifiers } from "./check-structure.ts";
import { isTest, ROOT, read } from "./ratchet.ts";

const CODE = /\.tsx?$/;
const RESOLVE = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export interface Graph {
  /** Code files under packages/, repo-relative. */
  files: string[];
  /** File -> the repo files it imports with a relative specifier (resolved). */
  imports: Map<string, string[]>;
}

export function isCode(file: string): boolean {
  return file.startsWith("packages/") && CODE.test(file) && !file.includes("/node_modules/");
}

/** The repo file a relative specifier names, or null when it is not a code file in the repo. */
export function resolveSpec(from: string, spec: string, exists: (file: string) => boolean = (f) => existsSync(join(ROOT, f))): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(join(dirname(from), spec));
  for (const ending of RESOLVE) {
    const file = base + ending;
    if (CODE.test(file) && exists(file)) return file;
  }
  return null;
}

export function buildGraph(all: string[]): Graph {
  const files = all.filter(isCode);
  const known = new Set(files);
  const imports = new Map<string, string[]>();
  for (const file of files) {
    const targets = specifiers(file, read(file))
      .map((spec) => resolveSpec(file, spec, (f) => known.has(f)))
      .filter((target): target is string => target !== null);
    imports.set(file, targets);
  }
  return { files, imports };
}

/** The top-level module folder a file sits in, or null (a module of one file, or no module). */
export function topModule(file: string): string | null {
  const parts = file.split("/");
  if (parts[0] !== "packages" || parts.length < 4) return null;
  const pkg = `packages/${parts[1]}`;
  if (parts[1] === "shell" && parts[2] === "apps") return parts.length >= 5 ? `${pkg}/apps/${parts[3]}` : null;
  if (parts[2] !== "src") return null;
  if (parts[1] === "shell" && parts[3] === "shared") return parts.length >= 6 ? `${pkg}/src/shared/${parts[4]}` : null;
  return parts.length >= 5 ? `${pkg}/src/${parts[3]}` : null;
}

/** Whether `folder` holds an index.ts(x) among the known files. */
function hasIndex(folder: string, known: Set<string>): boolean {
  return known.has(`${folder}/index.ts`) || known.has(`${folder}/index.tsx`);
}

/** Every module folder a file sits in, outermost first: its top module, then nested ones. */
export function moduleChain(file: string, known: Set<string>): string[] {
  const top = topModule(file);
  if (top === null) return [];
  const chain = [top];
  const rest = file
    .slice(top.length + 1)
    .split("/")
    .slice(0, -1);
  let folder = top;
  for (const part of rest) {
    if (part === "lib") break;
    folder = `${folder}/${part}`;
    if (hasIndex(folder, known)) chain.push(folder);
  }
  return chain;
}

export function inside(file: string, folder: string): boolean {
  return file.startsWith(`${folder}/`);
}

/** The folder of the nearest lib/ a file sits in, or null. */
export function libOwner(file: string): string | null {
  const at = file.lastIndexOf("/lib/");
  return at < 0 ? null : file.slice(0, at);
}

/** A module's public files: its index and what the index re-exports (never from lib/). */
export function publicFiles(folder: string, graph: Graph): Set<string> {
  const index = [`${folder}/index.ts`, `${folder}/index.tsx`].find((file) => graph.imports.has(file));
  if (index === undefined) return new Set();
  const targets = (graph.imports.get(index) ?? []).filter((target) => inside(target, folder) && libOwner(target) === null);
  return new Set([index, ...targets]);
}

/**
 * The module an import crosses into from outside: the outermost module of `to` that does not
 * hold `from`, or null when `to` is in no module or `from` sits inside all of them.
 */
export function crossedModule(from: string, to: string, known: Set<string>): string | null {
  return moduleChain(to, known).find((folder) => !inside(from, folder)) ?? null;
}

/** The module key a file counts as when we count users: its top module, or the file itself. */
export function userOf(file: string): string {
  return topModule(file) ?? file;
}

/** Every importer of a folder's files from outside it, as module keys, tests left out. */
export function outsideUsers(folder: string, graph: Graph): Set<string> {
  const users = new Set<string>();
  for (const [file, targets] of graph.imports) {
    if (isTest(file) || inside(file, folder)) continue;
    if (targets.some((target) => inside(target, folder))) users.add(userOf(file));
  }
  return users;
}

/** How many imports from outside reach a folder, and how many files make them (tests included). */
export function outsideImports(folder: string, graph: Graph): { files: number; imports: number } {
  let files = 0;
  let imports = 0;
  for (const [file, targets] of graph.imports) {
    if (inside(file, folder)) continue;
    const count = targets.filter((target) => inside(target, folder)).length;
    if (count > 0) files++;
    imports += count;
  }
  return { files, imports };
}
