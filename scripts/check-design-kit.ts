#!/usr/bin/env bun
// H22, controls come from the kit (docs/design.html UI-1, UI-8 to UI-15; conventions.md "UI Components"):
// outside packages/dashi-ui, in production .tsx files:
//   role:<r>     a View given accessibilityRole button, switch, checkbox, radio, tab, slider or link that
//                draws its own look (a fill, an edge or a radius in its style): a control made by hand.
//                Rows (menuitem, option) have their own rules (CO-9) and are left out.
//   text-input   a bare <TextInput> (the kit has TextField and SearchField)
//   defines      a component outside the kit named like a control the kit has (…Button, …Switch,
//                …Checkbox, …Segmented, …Field, …Sheet, …Tooltip, …Progress, …EmptyState, …Chip,
//                …Pill, …) that returns JSX. One that renders a kit Sheet or Button (a sheet of its
//                own built on the kit) is not one.
// Counted per file, each file on its workstream's list, scripts/lists/h22/<W>.txt, shrink-only.
// Run: bun scripts/check-design-kit.ts [--shrink] [--list]

import ts from "typescript";
import { byWorkstream, listedCounts } from "./design-lists.ts";
import { type Counts, read, repoFiles, report } from "./ratchet.ts";

const ROOTS = ["packages/shell/src/", "packages/shell/apps/", "packages/greeter/src/"];
const ROLES = new Set(["button", "switch", "checkbox", "radio", "tab", "slider", "link", "togglebutton"]);
const CONTROL_NAME =
  /(Button|Switch|Toggle|Slider|Checkbox|Tick|Segmented|SearchField|TextField|Field|Sheet|Dialog|Alert|Tooltip|Spinner|Progress|ProgressBar|EmptyState|Empty|Menu|Badge|Chip|Pill|Pills|Knob)$/;
/** What a component built on the kit renders: it is then the kit's control in place, not a new one. */
const KIT_FRAMES = new Set(["Sheet", "SheetCard", "AlertSheet", "FormSheet", "ConfirmSheet", "Button", "KitButton", "AlertWindow", "Chip"]);

export interface KitHit {
  file: string;
  line: number;
  kind: string;
  name: string;
}

export function isKitScanned(file: string): boolean {
  return ROOTS.some((root) => file.startsWith(root)) && file.endsWith(".tsx") && !/\.test\.tsx$/.test(file) && !/(^|\/)(test|tests|bench)\//.test(file);
}

function attribute(element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find((each): each is ts.JsxAttribute => ts.isJsxAttribute(each) && each.name.getText() === name);
}

function stringOf(attr: ts.JsxAttribute | undefined): string | undefined {
  const init = attr?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) return init.expression.text;
  return undefined;
}

/** A style that draws a control's own look: a fill, an edge or a radius. */
const drawsLook = (attr: ts.JsxAttribute | undefined): boolean => /backgroundColor|borderWidth|borderRadius/.test(attr?.getText() ?? "");

/** What a component's body renders: whether it returns JSX at all, and whether a kit frame is among it. */
function renders(body: ts.Node): { jsx: boolean; kit: boolean } {
  let jsx = false;
  let kit = false;
  const look = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) jsx = true;
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && KIT_FRAMES.has(node.tagName.getText())) kit = true;
    ts.forEachChild(node, look);
  };
  look(body);
  return { jsx, kit };
}

/** H22's hits in one file. */
export function kitControls(file: string, text: string): KitHit[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: KitHit[] = [];
  const line = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const define = (name: string, at: ts.Node, body: ts.Node | undefined): void => {
    if (!body || !/^[A-Z]/.test(name) || !CONTROL_NAME.test(name)) return;
    const { jsx, kit } = renders(body);
    if (jsx && !kit) hits.push({ file, line: line(at), kind: "defines", name });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const role = stringOf(attribute(node, "accessibilityRole"));
      if (tag === "View" && role && ROLES.has(role) && drawsLook(attribute(node, "style")))
        hits.push({ file, line: line(node), kind: `role:${role}`, name: tag });
      if (tag === "TextInput") hits.push({ file, line: line(node), kind: "text-input", name: tag });
    }
    if (ts.isFunctionDeclaration(node) && node.name) define(node.name.text, node, node.body);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      define(node.name.text, node, node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

export function kitHits(files: readonly string[], text: (file: string) => string = read): KitHit[] {
  return files.filter(isKitScanned).flatMap((file) => kitControls(file, text(file)));
}

if (import.meta.main) {
  const hits = kitHits(repoFiles());
  if (process.argv.includes("--list")) for (const hit of hits) console.log(`${hit.file}:${hit.line}\t${hit.kind}\t${hit.name}`);
  const found: Counts = new Map();
  for (const hit of hits) found.set(hit.file, (found.get(hit.file) ?? 0) + 1);
  const header = [
    "# H22 (scripts/check-design-kit.ts): controls drawn outside @dashi/ui, per file. Shrink-only: move each",
    "# onto the kit's control (UI-1, UI-8 to UI-15), then `bun scripts/check-design-kit.ts --shrink`.",
  ];
  const outcomes = byWorkstream("h22", found, "controls drawn outside the kit", header);
  console.log(`check-design-kit: ${hits.length} controls outside the kit; files listed per workstream: ${listedCounts(outcomes)}`);
  report("check-design-kit", outcomes);
}
