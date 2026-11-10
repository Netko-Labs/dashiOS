#!/usr/bin/env bun
// Move files with `git mv` and fix every relative path that names them (docs/conventions.md,
// "`lib/` And `shared/`"; the recipe: dashi-0.7.0-review/11-lib/RECIPE.md).
//
//   bun scripts/move.ts OLD NEW [OLD NEW ...]     move files (NEW may be a folder ending in /)
//
// Every string literal in a .ts/.tsx file under packages/ that starts with "./" or "../" and names
// a moved file (imports, `mock.module`, `join(import.meta.dir, …)`) is rewritten, in moved files
// and their importers alike, keeping how it was written (with or without the extension). Then
// it carries the moved files' entries in scripts/lists/ (list-rename). Docs are not touched:
// grep them for the old paths.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative } from "node:path";
import ts from "typescript";
import { carryAll } from "./list-rename.ts";
import { ROOT, repoFiles } from "./ratchet.ts";

const CODE = /\.tsx?$/;
const ENDINGS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

interface Hit {
  file: string;
  ending: string;
}

/** The repo file a relative path names from `from`, and how it was written. */
export function resolveLiteral(from: string, text: string, exists: (file: string) => boolean): Hit | null {
  if (!text.startsWith("./") && !text.startsWith("../")) return null;
  const base = normalize(join(dirname(from), text));
  for (const ending of ENDINGS) {
    if (exists(base + ending)) return { file: base + ending, ending };
  }
  return null;
}

/** The literal that names `target` from `from`, written with the same ending as before. */
export function literalFor(from: string, target: string, ending: string): string {
  const named = ending === "" ? target : target.slice(0, target.length - ending.length);
  const path = relative(dirname(from), named);
  return path.startsWith(".") ? path : `./${path}`;
}

/** Rewrite one file's relative literals; `was` is where the file sat before the move. */
export function rewrite(text: string, was: string, now: string, moves: Map<string, string>, exists: (file: string) => boolean): string {
  const source = ts.createSourceFile(now, text, ts.ScriptTarget.Latest, true, now.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits: { start: number; end: number; value: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      const hit = resolveLiteral(was, node.text, exists);
      const target = hit && (moves.get(hit.file) ?? hit.file);
      if (hit && target && (target !== hit.file || was !== now)) {
        const value = literalFor(now, target, hit.ending);
        if (value !== node.text) edits.push({ start: node.getStart(source) + 1, end: node.getEnd() - 1, value });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.value + out.slice(edit.end);
  return out;
}

/** OLD NEW pairs; a NEW ending in / is a folder the file keeps its name in. */
export function parsePairs(args: string[]): Map<string, string> {
  if (args.length === 0 || args.length % 2 !== 0) throw new Error("usage: bun scripts/move.ts OLD NEW [OLD NEW ...]");
  const moves = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const from = normalize(args[i] as string);
    const to = args[i + 1] as string;
    moves.set(from, to.endsWith("/") ? join(to, basename(from)) : normalize(to));
  }
  return moves;
}

function main(): void {
  const moves = parsePairs(process.argv.slice(2));
  const files = repoFiles();
  const known = new Set(files);
  for (const from of moves.keys()) if (!known.has(from)) throw new Error(`${from}: not in the repository`);
  const code = files.filter((file) => file.startsWith("packages/") && CODE.test(file));
  const texts = new Map(code.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]));
  for (const [from, to] of moves) {
    mkdirSync(join(ROOT, dirname(to)), { recursive: true });
    const run = Bun.spawnSync(["git", "mv", from, to], { cwd: ROOT, stderr: "pipe" });
    if (run.exitCode !== 0) throw new Error(`git mv ${from} ${to}: ${run.stderr.toString()}`);
  }
  let changed = 0;
  for (const [was, text] of texts) {
    const now = moves.get(was) ?? was;
    const out = rewrite(text, was, now, moves, (file) => known.has(file));
    if (out === text) continue;
    writeFileSync(join(ROOT, now), out);
    changed++;
  }
  console.log(`moved ${moves.size} files, rewrote paths in ${changed}`);
  for (const line of carryAll(moves)) console.log(line);
}

if (import.meta.main) main();
