#!/usr/bin/env bun
// Structure hard rules (docs/conventions.md, "Hard rules"), each a ratchet on a
// list in scripts/lists/ (see scripts/ratchet.ts):
//   H2  long-files     no file over 300 lines; a listed file may not grow
//   H3  long-functions no function over 80 lines as written (tests exempt); the
//                      measure, and why it is not Biome's, is scripts/function-lines.ts
//   H4  import-ways    apps -> apps/kit -> src/shared: src never imports apps,
//                      an app never imports another app, and apps reach src
//                      only through src/shared
//   H6  barrels        an index.ts(x) only re-exports (`export … from`)
//   H11 test-sleeps    tests never wait on real time (Bun.sleep, setTimeout)
//   H11 test-timeouts  no test raises its own time limit past bunfig.toml's 2 s
// Run: bun scripts/check-structure.ts [--shrink]

import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { type LongFunction, longFunctionsIn, MAX_FUNCTION_LINES } from "./function-lines.ts";
import { type Counts, isTest, type Outcome, ratchet, read, repoFiles, report } from "./ratchet.ts";

const MAX_LINES = 300;
const SOURCE = /\.(ts|tsx|rs)$/;
/** Generated code, which no person edits. */
const GENERATED = /(^|\/)ffi_generated\.rs$|\.gen(erated)?\.ts$/;
const SHELL = "packages/shell/";

export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function longFiles(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!SOURCE.test(file) || GENERATED.test(file)) continue;
    const lines = lineCount(read(file));
    if (lines > MAX_LINES) found.set(file, lines);
  }
  return found;
}

/** Every function over the limit, by file (tests exempt). */
export function longFunctions(files: string[]): Map<string, LongFunction[]> {
  const found = new Map<string, LongFunction[]>();
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || GENERATED.test(file) || isTest(file)) continue;
    const long = longFunctionsIn(file, read(file));
    if (long.length > 0) found.set(file, long);
  }
  return found;
}

/** The list holds each file's over-long functions' lines, summed; a failure names the functions. */
function checkFunctions(files: string[]): Outcome {
  const found = longFunctions(files);
  const sums: Counts = new Map([...found].map(([file, long]) => [file, long.reduce((sum, each) => sum + each.lines, 0)]));
  const outcome = ratchet("long-functions", sums, `lines in functions over ${MAX_FUNCTION_LINES}`);
  const named = (problem: string): string => {
    const long = found.get(problem.slice(0, problem.indexOf(": ")));
    return long ? `${problem}: ${long.map((each) => `${each.name} (line ${each.line}, ${each.lines} lines)`).join(", ")}` : problem;
  };
  return { ...outcome, problems: outcome.problems.map(named) };
}

/** The module specifiers a file imports or re-exports, static and dynamic. */
export function specifiers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments;
      if (first && ts.isStringLiteralLike(first)) found.push(first.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      found.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

type Area = { kind: "src"; shared: boolean } | { kind: "app"; app: string } | { kind: "other" };

export function areaOf(path: string): Area {
  if (path.startsWith(`${SHELL}src/`)) return { kind: "src", shared: path.startsWith(`${SHELL}src/shared/`) };
  const app = path.startsWith(`${SHELL}apps/`) ? path.slice(`${SHELL}apps/`.length).split("/")[0] : undefined;
  return app ? { kind: "app", app } : { kind: "other" };
}

/** Why an import from `from` to `to` goes the wrong way, or null. */
export function wrongWay(from: string, to: string): string | null {
  const a = areaOf(from);
  const b = areaOf(to);
  if (a.kind === "src" && b.kind === "app") return "src imports apps";
  if (a.kind === "app" && b.kind === "app" && b.app !== a.app && b.app !== "kit") return "an app imports another app";
  if (a.kind === "app" && b.kind === "src" && !b.shared) return "apps reach src outside src/shared";
  return null;
}

export function importWays(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!file.startsWith(SHELL) || !/\.tsx?$/.test(file) || isTest(file)) continue;
    let count = 0;
    for (const spec of specifiers(file, read(file))) {
      if (!spec.startsWith(".")) continue;
      if (wrongWay(file, normalize(join(dirname(file), spec)))) count++;
    }
    if (count > 0) found.set(file, count);
  }
  return found;
}

/** Statements in an index file that are not `export … from`. */
export function barrelExtras(file: string, text: string): number {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return source.statements.filter((statement) => !(ts.isExportDeclaration(statement) && statement.moduleSpecifier)).length;
}

export function barrels(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!/(^|\/)index\.tsx?$/.test(file) || !file.startsWith("packages/")) continue;
    const extras = barrelExtras(file, read(file));
    if (extras > 0) found.set(file, extras);
  }
  return found;
}

const SLEEP = /\bBun\.sleep\(|\bsetTimeout\(/g;

export function testSleeps(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || !isTest(file) || !file.startsWith("packages/")) continue;
    const count = read(file).match(SLEEP)?.length ?? 0;
    if (count > 0) found.set(file, count);
  }
  return found;
}

/** A test's own time limit past 2 s: `test(…, fn, 5_000)` ends in `}, 5_000);`. */
const LONG_LIMIT = /^\s*\}\s*,\s*(\d[\d_]*)\s*\);?\s*$/gm;

export function testTimeouts(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || !isTest(file) || !file.startsWith("packages/")) continue;
    const count = [...read(file).matchAll(LONG_LIMIT)].filter((match) => Number((match[1] ?? "0").replaceAll("_", "")) > 2000).length;
    if (count > 0) found.set(file, count);
  }
  return found;
}

export function checkStructure(files: string[]): Outcome[] {
  return [
    ratchet("long-files", longFiles(files), `over ${MAX_LINES} lines`),
    checkFunctions(files),
    ratchet("import-ways", importWays(files), "wrong-way imports"),
    ratchet("barrels", barrels(files), "statements besides `export … from`"),
    ratchet("test-sleeps", testSleeps(files), "real-time waits"),
    ratchet("test-timeouts", testTimeouts(files), "tests allowed over 2 s"),
  ];
}

if (import.meta.main) report("check-structure", checkStructure(repoFiles()));
