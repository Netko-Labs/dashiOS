#!/usr/bin/env bun
// Boundary hard rules (docs/conventions.md, "Hard rules"), each a ratchet on a
// list in scripts/lists/ (see scripts/ratchet.ts). Production code only; tests
// may cast.
//   H7  json-casts     `JSON.parse(…) as T`
//   H7  unknown-casts  `x as T` where x is `unknown` or `any` (outside data a
//                      cast pretends to check): IPC replies, D-Bus, files,
//                      subprocesses. Parse it with a parser instead. Also
//                      what a hand-written check leaves of them, cast the
//                      rest of the way: `object` (typeof x === "object"),
//                      `{}` (x != null) and a list of unknown
//                      (Array.isArray), and what `isRecord` or a parse
//                      leaves, `Record<string, unknown>`: its keys are known
//                      to be strings and nothing else. A shape narrows
//                      without a cast (decisions.md D31, D42).
//   H8  raw-requests   `request("method")` with a compositor IPC method
//                      (docs/compositor-ipc.md) outside packages/shell/src/compositor/client.ts
//   H10 return-types   an exported function in a .ts file without a return type
//                      (.tsx components are exempt)
// Run: bun scripts/check-boundaries.ts [--shrink]

import { join } from "node:path";
import ts from "typescript";
import { type Counts, isTest, type Outcome, ROOT, ratchet, read, report } from "./ratchet.ts";

/** The projects `bun run typecheck` checks. */
const PROJECTS = ["packages/shape", "packages/dashi-ui", "packages/applet", "packages/greeter", "packages/shell", "packages/shell/browser-extension"];
const COMPOSITOR = "packages/shell/src/compositor/client.ts";

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

function isUnchecked(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0;
}

/**
 * `unknown` or `any`, or what a typeof / null / Array.isArray check narrows
 * them to: `object`, `{}`, a list or tuple of unknown (null and undefined
 * beside them don't count). Nothing is known of such a value's fields, so a
 * cast from it checks nothing either.
 */
export function isLoose(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (isUnchecked(type) || (type.flags & ts.TypeFlags.NonPrimitive) !== 0) return true;
  if (type.isUnion()) {
    const rest = type.types.filter((each) => (each.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0);
    return rest.length > 0 && rest.every((each) => isLoose(each, checker));
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const entries = checker.getTypeArguments(type as ts.TypeReference);
    return entries.length > 0 && entries.every(isUnchecked);
  }
  return checker.typeToString(type) === "{}";
}

/** A literal written here (`{} as T`, `[] as T[]`): not outside data, whatever its type. */
function isLiteral(node: ts.Expression): boolean {
  const at = strip(node);
  return ts.isObjectLiteralExpression(at) || ts.isArrayLiteralExpression(at);
}

/** A cast to a type that says no more than the value's own (`as unknown[]`), or to a type parameter's (a generic parser's result, typed by its schema). */
function claimsNothing(target: ts.Type, checker: ts.TypeChecker): boolean {
  return isLoose(target, checker) || containsTypeParameter(target, checker);
}

function containsTypeParameter(type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean {
  if (depth > 4) return false;
  if ((type.flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional)) !== 0) return true;
  if (type.isUnionOrIntersection()) return type.types.some((each) => containsTypeParameter(each, checker, depth + 1));
  const args = type.aliasTypeArguments ?? ((type.flags & ts.TypeFlags.Object) !== 0 ? checker.getTypeArguments(type as ts.TypeReference) : []);
  if (args.some((each) => containsTypeParameter(each, checker, depth + 1))) return true;
  // A mapped type over a type parameter ({ [K in keyof S]: … }).
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 && ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0 && /\bin\b/.test(checker.typeToString(type))
  );
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

/**
 * A record of unknown: an object type with no named fields, whose every key holds `unknown`
 * (`Record<string, unknown>`, null and undefined beside it not counting). What `isRecord`
 * and `JSON.parse`'s checks give, and no more known of its fields than of `object`'s.
 */
export function isRecordOfUnknown(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (type.isUnion()) {
    const rest = type.types.filter((each) => (each.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0);
    return rest.length > 0 && rest.every((each) => isRecordOfUnknown(each, checker));
  }
  if ((type.flags & ts.TypeFlags.Object) === 0 || checker.getPropertiesOfType(type).length > 0) return false;
  const index = checker.getIndexInfosOfType(type);
  return index.length > 0 && index.every((info) => isUnchecked(info.type));
}

/**
 * A cast of a value a check narrowed from unknown (`isLoose`, or a record of unknown) to a type
 * that claims more. A record cast to another record of unknown claims nothing new.
 */
function isNarrowedCast(node: ts.AsExpression | ts.TypeAssertion, checker: ts.TypeChecker): boolean {
  if (isLiteral(node.expression)) return false;
  const from = checker.getTypeAtLocation(node.expression);
  const to = checker.getTypeFromTypeNode(node.type);
  if (isLoose(from, checker)) return !claimsNothing(to, checker);
  return isRecordOfUnknown(from, checker) && !claimsNothing(to, checker) && !isRecordOfUnknown(to, checker);
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
      else if (isUnchecked(checker.getTypeAtLocation(node.expression))) bump(into.unknown, file);
      else if (isNarrowedCast(node, checker)) bump(into.unknown, file);
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

const libraries = new Map<string, ts.SourceFile | undefined>();

/** The casts one file's text holds (a program of that file alone): what the tests ask. */
export function castsIn(text: string): { json: number; unknown: number } {
  const name = "/probe.ts";
  const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ESNext, types: [] };
  const host = ts.createCompilerHost(options);
  const fromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...rest) => {
    if (file === name) return ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true);
    // TypeScript's own library files, read once however many texts are asked about.
    if (!libraries.has(file)) libraries.set(file, fromDisk(file, ...rest));
    return libraries.get(file);
  };
  const onDisk = host.fileExists.bind(host);
  host.fileExists = (file) => file === name || onDisk(file);
  const program = ts.createProgram({ rootNames: [name], options, host });
  const source = program.getSourceFile(name);
  const into: Findings = { json: new Map(), unknown: new Map(), requests: new Map(), returns: new Map() };
  if (source) scan(name, source, program.getTypeChecker(), new Set(), into);
  return { json: into.json.get(name) ?? 0, unknown: into.unknown.get(name) ?? 0 };
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
