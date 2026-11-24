#!/usr/bin/env bun
// H24, design.html and the code agree (decisions.md D589): every element of docs/design.html that
// carries `data-token="NAME"` states that token's value in its text, NAME being a path into
// @dashi/ui's exports (`TYPE.body`, `RADIUS.card`, `MENU.padding`, `BUTTON.window.height`). The
// numbers in the text, in order, are the token's: a TYPE role is its size then its line (one or
// both may be stated), a WEIGHT its number (Metal names them: normal 400, semibold 600, bold 700,
// extralight 200, light 300, medium 500), a SHADOW its preset's name, anything else its number.
// A name that is no export fails as surely as a value that differs. No list: it fails on any row.
// Run: bun scripts/check-design-sync.ts [--list]

import { join } from "node:path";
import { ROOT, read } from "./ratchet.ts";

export interface Binding {
  token: string;
  text: string;
  line: number;
}

export interface Disagreement extends Binding {
  why: string;
}

const WEIGHTS: Readonly<Record<string, number>> = { thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700 };

/** Every bound element in a page's HTML: its token, its text without markup, its line. */
export function bindings(html: string): Binding[] {
  const found: Binding[] = [];
  for (const match of html.matchAll(/<(\w+)\b[^>]*\bdata-token="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const text = (match[3] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    found.push({ token: match[2] ?? "", text, line: html.slice(0, match.index).split("\n").length });
  }
  return found;
}

/** The value at a dotted path in `root`, or undefined. */
function at(root: unknown, path: string): unknown {
  let here: unknown = root;
  for (const part of path.split(".")) {
    if (here === null || (typeof here !== "object" && typeof here !== "function")) return undefined;
    here = Reflect.get(here, part);
  }
  return here;
}

/** What a token's value says, as the page writes it: numbers in order, or a name. */
export function stated(value: unknown): Array<number | string> | null {
  if (typeof value === "number") return [value];
  if (typeof value === "string") return WEIGHTS[value] !== undefined ? [WEIGHTS[value]] : [value];
  if (value !== null && typeof value === "object") {
    const size = Reflect.get(value, "size");
    const line = Reflect.get(value, "line");
    if (typeof size === "number" && typeof line === "number") return [size, line];
  }
  return null;
}

/** Why a binding disagrees with `tokens`, or null when the page says what the code holds. */
export function disagreement(binding: Binding, tokens: unknown): string | null {
  const value = at(tokens, binding.token);
  if (value === undefined) return `${binding.token} is no @dashi/ui export`;
  const want = stated(value);
  if (want === null) return `${binding.token} is not a measure`;
  const words = binding.text.match(/-?\d+(?:\.\d+)?|[a-z]+/gi) ?? [];
  const said: Array<number | string> = words
    .map((word) => (/^-?\d/.test(word) ? Number(word) : word))
    .filter((each) => typeof each === "number" || typeof want[0] === "string");
  if (said.length === 0) return `the page states no value for ${binding.token}`;
  const differs = said.some((each, index) => index >= want.length || each !== want[index]);
  return differs ? `the page says ${said.join(" / ")}, the code ${want.join(" / ")}` : null;
}

export async function checkSync(html: string): Promise<{ bound: number; wrong: Disagreement[] }> {
  const tokens: unknown = await import(join(ROOT, "packages/dashi-ui/src/index.ts"));
  const all = bindings(html);
  const wrong = all.flatMap((binding) => {
    const why = disagreement(binding, tokens);
    return why === null ? [] : [{ ...binding, why }];
  });
  return { bound: all.length, wrong };
}

if (import.meta.main) {
  const { bound, wrong } = await checkSync(read("docs/design.html"));
  if (process.argv.includes("--list"))
    for (const binding of bindings(read("docs/design.html"))) console.log(`${binding.line}\t${binding.token}\t${binding.text}`);
  for (const each of wrong) console.error(`  docs/design.html:${each.line} ${each.token} "${each.text}": ${each.why}`);
  console.log(`check-design-sync: ${bound} measures bound, ${wrong.length} disagree`);
  if (wrong.length > 0) process.exit(1);
}
