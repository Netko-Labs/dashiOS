// What the design checks read (H21, docs/design.html TK-1): every design value written as a literal
// in a style. The TypeScript parser walks each object literal and JSX attribute and reports:
//   colour      a hex or rgb()/hsl() string anywhere outside packages/dashi-ui/src/theme/ (a glyph's
//               SVG template, drawn in #000 and tinted where it is used, is not one), and a colour
//               property given a named colour ("white")
//   fontSize, weight, lineHeight, radius, opacity   that property given a literal
//   spacing     padding*, margin*, gap, rowGap, columnGap given a literal
//   shadow      a shadow preset written as a string
//   duration    setTimeout/setInterval's delay, a *Ms / *Duration property, given a literal
// A literal is raw where it is written: `12`, `-4`, `big ? 13 : 12`, `scaled(13)`. A name bound to a
// bare literal in the same file (`const PAD = 12`) counts too, as written where it is used. 0 never
// counts (it is no measure). Tests, benches and the theme folder's colours are left out.

import ts from "typescript";

export const SCANNED = ["packages/shell/src/", "packages/shell/apps/", "packages/greeter/src/", "packages/dashi-ui/src/"] as const;
export const THEME = "packages/dashi-ui/src/theme/";

export type Category = "colour" | "fontSize" | "weight" | "lineHeight" | "spacing" | "radius" | "shadow" | "opacity" | "duration";

export interface Hit {
  file: string;
  line: number;
  category: Category;
  /** The literal as written, without quotes. */
  value: string;
}

const COLOUR_PROPS = new Set([
  ...["color", "backgroundColor", "hoverBackgroundColor", "borderColor", "focusRingColor", "placeholderColor"],
  ...["focusBorderColor", "selectionColor", "fill", "stroke", "tint", "caretColor"],
]);
const SPACING = /^(padding|margin)(Horizontal|Vertical|Top|Bottom|Left|Right)?$|^(gap|rowGap|columnGap)$/;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC_COLOUR = /\b(?:rgba?|hsla?)\(/g;
const SVG_TEMPLATE = /<svg|<path|stroke=|fill=/;

/** A file the design checks read. */
export function isScanned(file: string): boolean {
  if (!SCANNED.some((root) => file.startsWith(root))) return false;
  if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts") || /\.test\.tsx?$/.test(file)) return false;
  return !/(^|\/)(test|tests|bench|node_modules)\//.test(file);
}

const nameOf = (name: ts.PropertyName | ts.JsxAttributeName): string => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : name.getText());

const isNumber = (node: ts.Expression): boolean => ts.isNumericLiteral(node);

/** Every literal leaf in an expression a style value is written as. */
function leaves(node: ts.Expression, out: ts.Expression[]): void {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return leaves(node.expression, out);
  if (ts.isConditionalExpression(node)) {
    leaves(node.whenTrue, out);
    leaves(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      leaves(node.left, out);
      leaves(node.right, out);
      return;
    }
    // `KNOB / 2`, `x * 0.5`: a literal that scales a name is arithmetic; `PAD + 2` adds a measure.
    if (isNumber(node.left) && isNumber(node.right)) out.push(node);
    else if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken) out.push(...[node.left, node.right].filter(isNumber));
    return;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && isNumber(node.operand)) {
    out.push(node);
    return;
  }
  if (ts.isCallExpression(node)) {
    out.push(...node.arguments.filter(isNumber));
    return;
  }
  out.push(node);
}

/** Names bound to a bare literal in the file: `const PAD = 12`. */
function localLiterals(source: ts.SourceFile): Map<string, ts.Expression> {
  const locals = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isNumericLiteral(init) || ts.isStringLiteral(init) || (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand));
      if (literal) locals.set(node.name.text, init);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return locals;
}

/** The category a style property's literal value falls in, or null when it is no design value. */
function categoryOf(key: string, raw: string): Category | null {
  if (key === "fontSize") return "fontSize";
  if (key === "fontWeight") return "weight";
  if (key === "lineHeight") return "lineHeight";
  if (SPACING.test(key)) return "spacing";
  if (key === "borderRadius" || /^border(Top|Bottom)(Left|Right)Radius$/.test(key)) return "radius";
  if (key === "opacity") return raw === "1" ? null : "opacity";
  if (key === "shadow") return /^[a-z]+$/.test(raw) ? "shadow" : null;
  if (/(Ms|Duration)$/.test(key) && /^-?[\d.]+$/.test(raw)) return "duration";
  if (COLOUR_PROPS.has(key) && /^[a-z]+$/i.test(raw) && !/^(transparent|none|currentColor)$/.test(raw)) return "colour";
  return null;
}

/** Every raw design value in one file's text. */
export function scanText(file: string, text: string): Hit[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const locals = localLiterals(source);
  const inTheme = file.startsWith(THEME);
  const hits: Hit[] = [];
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literalOf = (node: ts.Expression): ts.Expression | undefined => {
    if (ts.isNumericLiteral(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node;
    if (ts.isPrefixUnaryExpression(node) || ts.isBinaryExpression(node)) return node;
    return ts.isIdentifier(node) ? locals.get(node.text) : undefined;
  };
  const style = (key: string, init: ts.Expression, at: ts.Node): void => {
    const values: ts.Expression[] = [];
    leaves(init, values);
    for (const value of values) {
      const literal = literalOf(value);
      if (!literal) continue;
      const raw = ts.isStringLiteralLike(literal) ? literal.text : literal.getText(source);
      if (raw === "0" || raw === "-0") continue;
      const category = categoryOf(key, raw);
      if (category && !(inTheme && category === "colour")) hits.push({ file, line: lineOf(value === literal ? value : at), category, value: raw });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) style(nameOf(node.name), node.initializer, node);
    else if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
      style(nameOf(node.name), node.initializer.expression, node);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^set(Timeout|Interval)$/.test(node.expression.text) && node.arguments[1]) {
      const delay = node.arguments[1];
      const literal = literalOf(delay);
      if (literal && literal.getText(source) !== "0") hits.push({ file, line: lineOf(delay), category: "duration", value: literal.getText(source) });
    }
    if (!inTheme && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
      const words = node.text;
      if (!SVG_TEMPLATE.test(words)) {
        for (const match of words.matchAll(HEX))
          if ([3, 4, 6, 8].includes(match[0].length - 1)) hits.push({ file, line: lineOf(node), category: "colour", value: match[0] });
        for (const match of words.matchAll(FUNC_COLOUR)) hits.push({ file, line: lineOf(node), category: "colour", value: match[0] });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** TY-1's sizes, both rows and the named ones. */
const ON_SCALE_SIZE = new Set([9.5, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15, 17, 18, 20, 28, 120]);
/** RA-1's radii and named surfaces, and the pills still written as numbers (H21b names those). */
const ON_SCALE_RADIUS = new Set([2, 4, 5, 7, 9, 10, 10.5, 12, 14, 17.5, 18, 24, 28, 11, 13, 15, 15.5, 17, 20, 22]);
/** TY-2's weights for words. A display weight is written WEIGHT.display.*, never a literal. */
const WORD_WEIGHTS = new Set(["normal", "semibold", "bold", "400", "600", "700"]);
/** DE-1's shadows. */
const SHADOWS = new Set(["sm", "xl", "lg"]);

/**
 * H21a: off the scales. Any colour outside the theme; a size off TY-1; a radius off RA-1; a weight
 * off TY-2; a shadow off DE-1. (H21b, every literal measure, comes once the token swaps are done.)
 */
export function isOffScale(hit: Hit): boolean {
  const number = Number(hit.value);
  switch (hit.category) {
    case "colour":
      return true;
    case "fontSize":
      return Number.isFinite(number) && !ON_SCALE_SIZE.has(number);
    case "radius":
      return Number.isFinite(number) && !ON_SCALE_RADIUS.has(number);
    case "weight":
      return !WORD_WEIGHTS.has(hit.value);
    case "shadow":
      return !SHADOWS.has(hit.value);
    default:
      return false;
  }
}
