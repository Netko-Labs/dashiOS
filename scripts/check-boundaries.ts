#!/usr/bin/env bun
// Boundary hard rules (docs/conventions.md, "Hard rules"), each a ratchet on a
// list in scripts/lists/ (see scripts/ratchet.ts). Production code only; tests
// may cast.
//   H7  json-casts     `JSON.parse(…) as T`
//   H7  unknown-casts  `x as T` where x is `unknown` or `any` (outside data a
//                      cast pretends to check): IPC replies, D-Bus, files,
//                      subprocesses. Parse it with a parser instead.
//   H8  raw-requests   `request("method")` with a compositor IPC method
//                      (docs/compositor-ipc.md) outside packages/shell/src/compositor.ts
//   H10 return-types   an exported function in a .ts file without a return type
//                      (.tsx components are exempt)
// Run: bun scripts/check-boundaries.ts [--shrink]

import { join } from "node:path";
import ts from "typescript";
import { type Counts, isTest, type Outcome, ROOT, ratchet, read, report } from "./ratchet.ts";

/** The projects `bun run typecheck` checks. */
const PROJECTS = ["packages/shape", "packages/dashi-ui", "packages/applet", "packages/greeter", "packages/shell", "packages/shell/browser-extension"];
const COMPOSITOR = "packages/shell/src/compositor.ts";

/** The request methods in docs/compositor-ipc.md's tables ("## Requests" up to "## Events"). */
export function ipcMethods(doc: string): Set<string> {
  const start = doc.indexOf("\n## Requests");
  const end = doc.indexOf("\n## Events");
  const section = doc.slice(start, end < 0 ? undefined : end);
  return new Set([...section.matchAll(/^\| `([a-z][a-z-]*)` \|/gm)].map((match) => match[1] ?? ""));
}

function strip(node: ts.Expression): ts.Expression {
  let at = node;
  while (ts.isParenthesizedExpression(at) || ts.isAwaitExpression(at) || ts.isNonNullExpression(at)) at = at.expression;
  return at;
}

function isJsonParse(node: ts.Expression): boolean {
  const call = strip(node);
  return ts.isCallExpression(call) && call.expression.getText() === "JSON.parse";
}

function isLoose(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0;
}

function isConst(type: ts.TypeNode): boolean {
  return ts.isTypeReferenceNode(type) && type.typeName.getText() === "const";
}

function isLooseNode(type: ts.TypeNode): boolean {
  return type.kind === ts.SyntaxKind.UnknownKeyword || type.kind === ts.SyntaxKind.AnyKeyword;
}

/** An exported function (declaration, or a const holding an arrow or function) with no return type. */
function untypedExport(node: ts.Node): boolean {
  const exported = (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
  if (ts.isFunctionDeclaration(node)) return exported && node.body !== undefined && node.type === undefined;
  if (!ts.isVariableStatement(node) || !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return false;
  return node.declarationList.declarations.some((declaration) => {
    const value = declaration.initializer;
    if (declaration.type || !value) return false;
    return (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && value.type === undefined;
  });
}

export interface Findings {
  json: Counts;
  unknown: Counts;
  requests: Counts;
  returns: Counts;
}

function bump(counts: Counts, file: string): void {
  counts.set(file, (counts.get(file) ?? 0) + 1);
}

function scan(file: string, source: ts.SourceFile, checker: ts.TypeChecker, methods: Set<string>, into: Findings): void {
  const visit = (node: ts.Node): void => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConst(node.type) && !isLooseNode(node.type)) {
      if (isJsonParse(node.expression)) bump(into.json, file);
      else if (isLoose(checker.getTypeAtLocation(node.expression))) bump(into.unknown, file);
    }
    if (file !== COMPOSITOR && ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      const [first] = node.arguments;
      if (name === "request" && first && ts.isStringLiteralLike(first) && methods.has(first.text)) bump(into.requests, file);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (file.endsWith(".ts")) for (const statement of source.statements) if (untypedExport(statement)) bump(into.returns, file);
}

export function findBoundaries(): Findings {
  const methods = ipcMethods(read("docs/compositor-ipc.md"));
  const into: Findings = { json: new Map(), unknown: new Map(), requests: new Map(), returns: new Map() };
  const seen = new Set<string>();
  for (const project of PROJECTS) {
    const configPath = join(ROOT, project, "tsconfig.json");
    const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
    if (!config) throw new Error(`cannot read ${configPath}`);
    const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
    const checker = program.getTypeChecker();
    for (const source of program.getSourceFiles()) {
      const file = source.fileName.startsWith(`${ROOT}/`) ? source.fileName.slice(ROOT.length + 1) : null;
      if (!file?.startsWith("packages/") || file.includes("node_modules/") || isTest(file) || seen.has(file)) continue;
      seen.add(file);
      scan(file, source, checker, methods, into);
    }
  }
  return into;
}

export function checkBoundaries(found: Findings = findBoundaries()): Outcome[] {
  return [
    ratchet("json-casts", found.json, "`JSON.parse(…) as` casts"),
    ratchet("unknown-casts", found.unknown, "casts of unknown data"),
    ratchet("raw-requests", found.requests, "raw compositor requests"),
    ratchet("return-types", found.returns, "exported functions without a return type"),
  ];
}

if (import.meta.main) report("check-boundaries", checkBoundaries());
