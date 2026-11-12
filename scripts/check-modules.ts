#!/usr/bin/env bun

// Module hard rules (docs/conventions.md, "`lib/` And `shared/`"), each a ratchet on a list in
// scripts/lists/ (see scripts/ratchet.ts). What a module is: scripts/modules.ts.
//   H18 lib-imports    only a module's own files import its lib/ (tests may, to test a private
//                      helper); lib/ is never in a package's exports or bin; lib/ holds no main.ts
//   H19 deep-imports   from outside a module, import its index.ts or a file its index.ts
//                      re-exports (tests may also import its lib/, and a nested module's
//                      public files)
//   H19 re-exports     only an index.ts (or a file a package's exports name) re-exports: no file
//                      keeps an old import path alive
//   H20 shared-use     a shared/ concern is used by two sibling modules or more (count: how many
//                      it lacks), sits in a folder named for its concern, and is never a catch-all
// Run: bun scripts/check-modules.ts [--shrink]

import { join, normalize } from "node:path";
import ts from "typescript";
import { buildGraph, crossedModule, type Graph, inside, libOwner, moduleChain, outsideUsers, publicFiles } from "./modules.ts";
import { type Counts, isTest, type Outcome, ratchet, read, repoFiles, report } from "./ratchet.ts";

/** Folder names that say nothing about their concern. */
const CATCH_ALL = new Set(["common", "helpers", "lib", "misc", "shared", "util", "utils"]);

function bump(found: Counts, key: string, by = 1): void {
  found.set(key, (found.get(key) ?? 0) + by);
}

/** H18: imports of a lib/ from outside the folder that owns it (tests exempt). */
export function libImports(graph: Graph): Counts {
  const found: Counts = new Map();
  for (const [file, targets] of graph.imports) {
    if (isTest(file)) continue;
    for (const target of targets) {
      const owner = libOwner(target);
      if (owner !== null && !inside(file, owner)) bump(found, file);
    }
  }
  return found;
}

/** Every string under a package.json's `exports` and `bin`. */
export function entryPaths(manifest: unknown): string[] {
  const strings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (typeof value !== "object" || value === null) return [];
    return Object.values(value).flatMap(strings);
  };
  if (typeof manifest !== "object" || manifest === null) return [];
  return Object.entries(manifest)
    .filter(([key]) => key === "exports" || key === "bin")
    .flatMap(([, value]) => strings(value));
}

/** H18: a package's exports or bin naming a lib/, and entry points kept in a lib/. */
export function libEntries(all: string[]): Counts {
  const found: Counts = new Map();
  for (const file of all) {
    if (/^packages\/[^/]+\/package\.json$/.test(file)) {
      const manifest: unknown = Bun.JSONC.parse(read(file));
      const count = entryPaths(manifest).filter((path) => /(^|\/)lib\//.test(path)).length;
      if (count > 0) found.set(file, count);
    } else if (/\/lib\/(.*\/)?main\.tsx?$/.test(file)) {
      found.set(file, 1);
    }
  }
  return found;
}

/**
 * H19: imports from outside a module that skip its public files. A test may also import any lib/,
 * and the public files of a nested module (docs/decisions.md D7), as it may a top-level one's.
 */
export function deepImports(graph: Graph): Counts {
  const known = new Set(graph.files);
  const publics = new Map<string, Set<string>>();
  const publicOf = (folder: string): Set<string> => {
    if (!publics.has(folder)) publics.set(folder, publicFiles(folder, graph));
    return publics.get(folder) ?? new Set();
  };
  const found: Counts = new Map();
  for (const [file, targets] of graph.imports) {
    for (const target of targets) {
      const folder = crossedModule(file, target, known);
      if (folder === null) continue;
      if (publicOf(folder).has(target)) continue;
      if (isTest(file) && libOwner(target) !== null) continue;
      if (isTest(file) && moduleChain(target, known).some((module) => publicOf(module).has(target))) continue;
      bump(found, file);
    }
  }
  return found;
}

/** Every folder named shared/ under packages/, from the files in it. */
function sharedFolders(graph: Graph): Set<string> {
  const folders = new Set<string>();
  for (const file of graph.files) {
    const at = file.indexOf("/shared/");
    if (at >= 0) folders.add(file.slice(0, at + "/shared".length));
  }
  return folders;
}

/** H20: shared/ concerns with fewer than two users, loose files in shared/, catch-all concerns. */
export function sharedUse(graph: Graph): Counts {
  const found: Counts = new Map();
  for (const shared of sharedFolders(graph)) {
    const concerns = new Set<string>();
    for (const file of graph.files) {
      if (!inside(file, shared)) continue;
      const rest = file.slice(shared.length + 1).split("/");
      if (rest.length === 1) found.set(file, 2);
      else concerns.add(`${shared}/${rest[0]}`);
    }
    for (const concern of concerns) {
      const name = concern.slice(shared.length + 1);
      const lacks = Math.max(0, 2 - outsideUsers(concern, graph).size) + (CATCH_ALL.has(name) ? 2 : 0);
      if (lacks > 0) found.set(concern, lacks);
    }
  }
  return found;
}

/** Files a package's `exports` name: a package's facades, which may re-export. */
function exportedFiles(all: string[]): Set<string> {
  const files = new Set<string>();
  for (const manifest of all.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file))) {
    const folder = manifest.slice(0, -"package.json".length);
    for (const path of entryPaths(Bun.JSONC.parse(read(manifest)))) files.add(normalize(join(folder, path)));
  }
  return files;
}

/** H19: re-exports (`export … from`) outside an index.ts and a package's facades: old paths kept alive. */
export function reExports(graph: Graph, facades: Set<string>): Counts {
  const found: Counts = new Map();
  for (const file of graph.files) {
    if (/(^|\/)index\.tsx?$/.test(file) || facades.has(file)) continue;
    const count = reExportCount(file, read(file));
    if (count > 0) found.set(file, count);
  }
  return found;
}

export function reExportCount(file: string, text: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return source.statements.filter((statement) => ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined).length;
}

export function checkModules(all: string[]): Outcome[] {
  const graph = buildGraph(all);
  const lib = libImports(graph);
  for (const [key, count] of libEntries(all)) bump(lib, key, count);
  return [
    ratchet("lib-imports", lib, "imports of another module's lib/, or lib/ as an entry"),
    ratchet("deep-imports", deepImports(graph), "imports past a module's index.ts"),
    ratchet("re-exports", reExports(graph, exportedFiles(all)), "re-exports outside an index.ts"),
    ratchet("shared-use", sharedUse(graph), "shared/ code missing a second user, or not in a concern folder"),
  ];
}

if (import.meta.main) report("check-modules", checkModules(repoFiles()));
