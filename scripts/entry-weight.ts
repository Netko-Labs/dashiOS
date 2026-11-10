#!/usr/bin/env bun
// How many of Dashi's own files each entry point loads when it starts (docs/conventions.md,
// "`lib/` And `shared/`": a barrel must not make a process load more than it did). Static
// imports only, type-only ones left out; a dynamic import() is lazy and not followed.
//
//   bun scripts/entry-weight.ts                   every entry point (bin/, main.ts(x), src/session.ts):
//                                                 files and modules it loads
//   bun scripts/entry-weight.ts --compare REF     the entries that now load a module they did not
//                                                 load at REF (exit 1), and file counts that moved
//   bun scripts/entry-weight.ts --check           against the baseline, scripts/lists/entry-weight.tsv:
//                                                 an entry that loads a module its baseline lacks fails,
//                                                 and so does a baseline module it no longer loads
//   bun scripts/entry-weight.ts --shrink          drop from the baseline what entries no longer load
//   bun scripts/entry-weight.ts --update          write the baseline as it is now: for a module an entry
//                                                 is meant to load from now on (say why in the commit)
//   bun scripts/entry-weight.ts --why ENTRY FILE  the chain of imports by which ENTRY loads FILE
//
// Moves are followed (git's rename detection): a file moved into a module folder, or a folder
// renamed, is the same module as before, not a new one.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { userOf } from "./modules.ts";
import { ROOT } from "./ratchet.ts";
import { follow, gitRenames, parseRenames } from "./renames.ts";

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

/**
 * Where a module of before is now, given git's renames (old path -> new path): a module of one
 * file that moved into a folder is that folder's module; a folder whose files moved is the
 * module its first moved file is in now. A module nothing moved out of keeps its name.
 */
export function movedModule(module: string, moved: Map<string, string>, exists: (path: string) => boolean = (p) => existsSync(join(ROOT, p))): string {
  if (exists(module)) return module;
  if (moved.has(module)) return userOf(follow(module, moved, exists));
  const inside = [...moved.keys()].filter((from) => from.startsWith(`${module}/`)).sort();
  return inside[0] === undefined ? module : userOf(follow(inside[0], moved, exists));
}

/** Entries that load a module they did not load at `ref`, with those modules; `rename` maps a module of before to its name now. */
export function compare(now: Map<string, Weight>, before: Map<string, Weight>, rename: (module: string) => string = (module) => module): Map<string, string[]> {
  const grown = new Map<string, string[]>();
  for (const [entry, weight] of now) {
    const was = before.get(entry);
    if (was === undefined) continue;
    const known = new Set([...was.modules].map(rename));
    const added = [...weight.modules].filter((module) => !known.has(module)).sort();
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

const BASELINE = join(ROOT, "scripts", "lists", "entry-weight.tsv");
const HEADER =
  "# Entry weight: the modules each entry point loads when it starts (scripts/entry-weight.ts; a module is a folder, or a file outside one). A module not listed for its entry fails `bun run check`; so does a listed one it no longer loads (--shrink). For a module an entry is meant to load from now on: --update, and say why in the commit.";

/** The baseline's `entry<TAB>module` lines, per entry. */
export function parseBaseline(text: string): Map<string, Set<string>> {
  const base = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const [entry, module] = line.split("\t");
    if (entry && module) base.set(entry, (base.get(entry) ?? new Set()).add(module));
  }
  return base;
}

export function formatBaseline(base: Map<string, Set<string>>): string {
  const lines = [...base].sort(([a], [b]) => a.localeCompare(b)).flatMap(([entry, modules]) => [...modules].sort().map((module) => `${entry}\t${module}`));
  return `${[HEADER, ...lines].join("\n")}\n`;
}

/** What differs from the baseline: modules an entry loads beyond it, and listed ones it no longer loads. */
export function againstBaseline(
  now: Map<string, Weight>,
  base: Map<string, Set<string>>,
  rename: (module: string) => string,
): { grown: string[]; stale: string[] } {
  const grown: string[] = [];
  const stale: string[] = [];
  for (const [entry, weight] of now) {
    const listed = new Set([...(base.get(entry) ?? [])].map(rename));
    for (const module of [...weight.modules].sort()) if (!listed.has(module)) grown.push(`${entry} loads ${module}`);
    for (const module of [...listed].sort()) if (!weight.modules.has(module)) stale.push(`${entry} no longer loads ${module}`);
  }
  for (const entry of base.keys()) if (!now.has(entry)) stale.push(`${entry} is no entry point now`);
  return { grown, stale };
}

/** --check, --shrink (never adds a module) and --update (writes what loads now). */
function baseline(mode: string, now: Map<string, Weight>): void {
  const base = parseBaseline(existsSync(BASELINE) ? readFileSync(BASELINE, "utf8") : "");
  const moved = gitRenames();
  const rename = (module: string): string => movedModule(module, moved);
  if (mode === "--update" || mode === "--shrink") {
    const next = new Map<string, Set<string>>();
    for (const [entry, weight] of now) {
      const listed = new Set([...(base.get(entry) ?? [])].map(rename));
      next.set(entry, new Set([...weight.modules].filter((module) => mode === "--update" || listed.has(module))));
    }
    writeFileSync(BASELINE, formatBaseline(next));
    return console.log(`entry-weight: ${mode === "--update" ? "wrote" : "shrank"} scripts/lists/entry-weight.tsv`);
  }
  const { grown, stale } = againstBaseline(now, base, rename);
  for (const line of grown) console.log(`  ${line}, which scripts/lists/entry-weight.tsv does not list (a barrel, or a new import at start?)`);
  for (const line of stale) console.log(`  ${line}: trim the baseline (bun scripts/entry-weight.ts --shrink)`);
  const failed = grown.length + stale.length > 0;
  console.log(failed ? "entry-weight: the baseline differs (see --why ENTRY FILE)" : `entry-weight: ok (${now.size} entries)`);
  if (failed) process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args[0] === "--why") return why(args[1] ?? "", args[2] ?? "");
  const now = weights(sources());
  if (args[0] === "--check" || args[0] === "--shrink" || args[0] === "--update") return baseline(args[0], now);
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
  const moved = parseRenames(Bun.spawnSync(["git", "diff", "-M", "--name-status", ref], { cwd: ROOT }).stdout.toString());
  const grown = compare(now, before, (module) => movedModule(module, moved));
  for (const [entry, added] of grown) console.log(`${entry} now loads ${added.join(", ")}`);
  console.log(grown.size === 0 ? `entry-weight: no entry loads a module it did not load at ${ref}` : `entry-weight: ${grown.size} entries load more modules`);
  if (grown.size > 0) process.exit(1);
}

if (import.meta.main) main();
