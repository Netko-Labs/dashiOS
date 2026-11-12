// H3's measure (docs/conventions.md, "Hard rules"): a function's lines as written, from the line
// its `function`, name or parameter list starts on to the line its body ends on.
//
// Biome's `noExcessiveLinesPerFunction` counts the line breaks between a body's tokens. A line
// break inside one token is not between two, so it misses every line of JSX children (the
// whitespace between two elements is a JSX text token) and of a template string: a 97-line
// component counted 51. It has no option for it (`maxLines`, `skipBlankLines`, `skipIifes`).
// The rule says lines, so this counts lines.

import ts from "typescript";

export const MAX_FUNCTION_LINES = 80;

export interface LongFunction {
  name: string;
  /** The line it starts on, from 1. */
  line: number;
  lines: number;
}

type Fn = ts.FunctionLikeDeclaration;

function isFunction(node: ts.Node): node is Fn {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isAccessor(node)) &&
    node.body !== undefined
  );
}

function nameOf(node: Fn): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const own = node.name;
  if (own && (ts.isIdentifier(own) || ts.isPrivateIdentifier(own) || ts.isStringLiteral(own))) return own.text;
  const holder = node.parent;
  if ((ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) && ts.isIdentifier(holder.name)) {
    return holder.name.text;
  }
  return "(anonymous)";
}

/** Every function in a file longer than `max` lines, nested ones included, in source order. */
export function longFunctionsIn(file: string, text: string, max: number = MAX_FUNCTION_LINES): LongFunction[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: LongFunction[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunction(node)) {
      const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
      const lines = last - first + 1;
      if (lines > max) found.push({ name: nameOf(node), line: first + 1, lines });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
