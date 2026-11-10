#!/usr/bin/env bun
// How many of Dashi's own files each entry point loads when it starts (docs/conventions.md,
// "`lib/` And `shared/`": a barrel must not make a process load more than it did). Static
// imports only, type-only ones left out; a dynamic import() is lazy and not followed.
//
//   bun scripts/entry-weight.ts                   every entry point (bin/, main.ts(x), src/session.ts):
//                                                 files and modules it loads
//   bun scripts/entry-weight.ts --compare REF     the entries that now load a module they did not
//                                                 load at REF (exit 1), and file counts that moved
//   bun scripts/entry-weight.ts --why ENTRY FILE  the chain of imports by which ENTRY loads FILE

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { userOf } from "./modules.ts";
import { ROOT } from "./ratchet.ts";

const ENDINGS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const ENTRY = /^packages\/shell\/bin\/[^/]+\.tsx?$|^packages\/[^/]+\/(src|apps\/[^/]+)\/main\.tsx?$|^packages\/shell\/src\/session\.ts$/;

/** The code files under packages/ and their text, now or at a git ref. */
export function sources(ref?: string): Map<string, string> {
  const listing = ref
    ? ["git", "ls-tree", "-r", "--name-only", ref, "packages"]
    : ["git", "ls-files", "--cached", "--others", "--exclude-standard", "packages"];
  const names = Bun.spawnSync(listing, { cwd: ROOT })
    .stdout.toString()
    .split("\n")
    .filter((file) => /\.tsx?$/.test(file) && !file.includes("/node_modules/"));
  if (!ref) return new Map(names.filter((file) => existsSync(join(ROOT, file))).map((file) => [file, readFileSync(join(ROOT, file), "utf8")]));
  const batch = Bun.spawnSync(["git", "cat-file", "--batch"], { cwd: ROOT, stdin: Buffer.from(names.map((file) => `${ref}:${file}`).join("\n")) }).stdout;
  const texts = new Map<string, string>();
  let at = 0;
  for (const file of names) {
    const end = batch.indexOf(10, at);
    const size = Number(batch.subarray(at, end).toString().split(" ")[2]);
    texts.set(file, batch.subarray(end + 1, end + 1 + size).toString());
    at = end + 1 + size + 1;
  }
  return texts;
}

/** The specifiers a file loads when it runs: static, not type-only. */
export function runtimeSpecifiers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typesOnly =
        clause?.isTypeOnly ||
        (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly));
      if (!typesOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const typesOnly = node.isTypeOnly || (clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
      if (!typesOnly) found.push(node.moduleSpecifier.text);
    }
  }
  return found;
}

/** Each file -> the repo files it loads. */
export function loads(texts: Map<string, string>): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [file, text] of texts) {
    const targets = runtimeSpecifiers(file, text).flatMap((spec) => {
      if (!spec.startsWith(".")) return [];
      const base = normalize(join(dirname(file), spec));
      const hit = ENDINGS.map((ending) => base + ending).find((name) => texts.has(name));
      return hit ? [hit] : [];
    });
    graph.set(file, targets);
  }
  return graph;
}

/** Every file an entry loads, each with the file that loaded it first. */
export function closure(entry: string, graph: Map<string, string[]>): Map<string, string | null> {
  const from = new Map<string, string | null>([[entry, null]]);
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    for (const target of graph.get(file) ?? []) {
      if (from.has(target)) continue;
      from.set(target, file);
      stack.push(target);
    }
  }
  return from;
}

export interface Weight {
  files: number;
  /** The modules it loads (scripts/modules.ts: a module folder, or a file outside one). */
  modules: Set<string>;
}

export function weights(texts: Map<string, string>): Map<string, Weight> {
  const graph = loads(texts);
  const entries = [...texts.keys()].filter((file) => ENTRY.test(file)).sort();
  return new Map(
    entries.map((entry) => {
      const files = [...closure(entry, graph).keys()];
      return [entry, { files: files.length, modules: new Set(files.map(userOf)) }];
    }),
  );
}

/** Entries that load a module they did not load at `ref`, with those modules. */
export function compare(now: Map<string, Weight>, before: Map<string, Weight>): Map<string, string[]> {
  const grown = new Map<string, string[]>();
  for (const [entry, weight] of now) {
    const was = before.get(entry);
    if (was === undefined) continue;
    const added = [...weight.modules].filter((module) => !was.modules.has(module)).sort();
    if (added.length > 0) grown.set(entry, added);
  }
  return grown;
}

function why(entry: string, file: string): void {
  const from = closure(entry, loads(sources()));
  if (!from.has(file)) return console.log(`${entry} does not load ${file}`);
  const chain: string[] = [];
  for (let at: string | null | undefined = file; at; at = from.get(at)) chain.unshift(at);
  console.log(chain.join("\n  -> "));
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--why") return why(args[1] ?? "", args[2] ?? "");
  const now = weights(sources());
  if (args[0] !== "--compare") {
    for (const [entry, weight] of now) console.log(`${weight.files}\t${weight.modules.size}\t${entry}`);
    return;
  }
  const ref = args[1] ?? "HEAD";
  const before = weights(sources(ref));
  for (const [entry, weight] of now) {
    const was = before.get(entry);
    if (was && was.files !== weight.files) console.log(`  ${entry}: ${was.files} -> ${weight.files} files`);
  }
  const grown = compare(now, before);
  for (const [entry, added] of grown) console.log(`${entry} now loads ${added.join(", ")}`);
  console.log(grown.size === 0 ? `entry-weight: no entry loads a module it did not load at ${ref}` : `entry-weight: ${grown.size} entries load more modules`);
  if (grown.size > 0) process.exit(1);
}

if (import.meta.main) main();
