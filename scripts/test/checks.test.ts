// The hard-rule checks' pure parts: what each counts as an offence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STEPS } from "../check.ts";
import { castsIn, ipcMethods } from "../check-boundaries.ts";
import { allowed } from "../check-licenses.ts";
import { barrelExtras, lineCount, specifiers, wrongWay } from "../check-structure.ts";
import { longFunctionsIn } from "../function-lines.ts";

describe("H2 line count", () => {
  test("counts lines with or without a final newline", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });
});

describe("H3 function lines", () => {
  const rows = (count: number, row: string): string => Array.from({ length: count }, () => row).join("\n");
  test("counts a function from its first line to its last, as written", () => {
    const text = "export function five(): number {\n  // a comment\n\n  return 1;\n}\n";
    expect(longFunctionsIn("x.ts", text, 4)).toEqual([{ name: "five", line: 1, lines: 5 }]);
    expect(longFunctionsIn("x.ts", text, 5)).toEqual([]);
  });
  test("counts the lines of JSX children and of a template string, which Biome's rule skips", () => {
    const view = `export function View() {\n  return (\n    <div>\n${rows(80, "      <span>row</span>")}\n    </div>\n  );\n}\n`;
    expect(longFunctionsIn("x.tsx", view)).toEqual([{ name: "View", line: 1, lines: 86 }]);
    const text = `export const help = (): string => {\n  return \`\n${rows(80, "line")}\n\`;\n};\n`;
    expect(longFunctionsIn("x.ts", text)).toEqual([{ name: "help", line: 1, lines: 84 }]);
  });
  test("names methods, and counts a nested function as its own as well", () => {
    const text = `class Box {\n  open(): void {\n    const inner = () => {\n${rows(3, "      step();")}\n    };\n    inner();\n  }\n}\n`;
    expect(longFunctionsIn("x.ts", text, 4)).toEqual([
      { name: "open", line: 2, lines: 8 },
      { name: "inner", line: 3, lines: 5 },
    ]);
  });
});

describe("H4 import direction", () => {
  const shell = "packages/shell";
  test("src never imports apps", () => {
    expect(wrongWay(`${shell}/src/main.tsx`, `${shell}/apps/kit/clipboard.ts`)).toBe("src imports apps");
  });
  test("an app imports only itself, the kit and src/shared", () => {
    expect(wrongWay(`${shell}/apps/notes/view.tsx`, `${shell}/apps/notes/store.ts`)).toBeNull();
    expect(wrongWay(`${shell}/apps/notes/view.tsx`, `${shell}/apps/kit/run.tsx`)).toBeNull();
    expect(wrongWay(`${shell}/apps/notes/view.tsx`, `${shell}/src/shared/time.ts`)).toBeNull();
    expect(wrongWay(`${shell}/apps/notes/view.tsx`, `${shell}/apps/files/store.ts`)).toBe("an app imports another app");
    expect(wrongWay(`${shell}/apps/kit/menus.ts`, `${shell}/src/settings-app/store.ts`)).toBe("apps reach src outside src/shared");
  });
  test("finds static, dynamic and type imports", () => {
    const text = 'import a from "./a.ts";\nexport { b } from "./b.ts";\nconst c = await import("./c.ts");\ntype D = import("./d.ts").D;\n';
    expect(specifiers("x.ts", text)).toEqual(["./a.ts", "./b.ts", "./c.ts", "./d.ts"]);
  });
});

describe("H6 barrels", () => {
  test("re-exports only", () => {
    expect(barrelExtras("index.ts", 'export { a } from "./a.ts";\nexport * from "./b.ts";\nexport type { C } from "./c.ts";\n')).toBe(0);
  });
  test("anything else counts", () => {
    expect(barrelExtras("index.ts", 'import { a } from "./a.ts";\nexport { a };\nexport const b = 1;\nstart();\n')).toBe(4);
  });
});

describe("H7 casts", () => {
  const count = (body: string): number => castsIn(`interface Box { x: number }\nexport function read(value: unknown) {\n${body}\n}\n`).unknown;
  test("a cast of unknown, and of JSON.parse", () => {
    expect(count("return value as Box;")).toBe(1);
    expect(castsIn('export const box = JSON.parse("{}") as { x: number };')).toEqual({ json: 1, unknown: 0 });
  });
  test("a cast of what a hand-written check leaves of unknown: object, {}, a list of unknown", () => {
    expect(count('return typeof value === "object" && value !== null ? (value as Box) : null;')).toBe(1);
    expect(count('return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;')).toBe(1);
    expect(count("return value != null ? (value as Box) : null;")).toBe(1);
    expect(count("return Array.isArray(value) ? (value as number[]) : [];")).toBe(1);
    expect(count("const list: unknown[] = []; return list as [string, number];")).toBe(1);
  });
  test("not a cast that claims nothing, a literal, a checked value, or a generic parser's own result", () => {
    expect(count("return Array.isArray(value) ? (value as unknown[]) : [];")).toBe(0);
    expect(count("return {} as Box;")).toBe(0);
    expect(count('return typeof value === "string" ? (value as "a" | "b") : null;')).toBe(0);
    expect(count('return Array.isArray(value) && value.every((n): n is number => typeof n === "number") ? value : [];')).toBe(0);
    expect(castsIn("export function all<T>(list: unknown[]): T[] {\n  return list as T[];\n}\n").unknown).toBe(0);
  });
});

describe("H8 compositor methods", () => {
  test("reads the request tables and stops at the events", () => {
    const doc = "# x\n## Requests\n| `windows` | `{}` | x |\n| `send-keys` | x | x |\n## Events\n| `window-opened` | x |\n";
    expect([...ipcMethods(doc)]).toEqual(["windows", "send-keys"]);
  });
});

describe("H15 licences", () => {
  test("a choice needs one allowed side", () => {
    expect(allowed("MIT")).toBe(true);
    expect(allowed("Apache-2.0 OR GPL-2.0-only")).toBe(true);
    expect(allowed("MIT/Apache-2.0")).toBe(true);
    expect(allowed("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT")).toBe(true);
  });
  test("a conjunction needs every part allowed", () => {
    expect(allowed("(MIT OR Apache-2.0) AND Unicode-3.0")).toBe(false);
    expect(allowed("(Apache-2.0 OR MIT) AND BSD-3-Clause")).toBe(true);
  });
  test("copyleft and unknown licences are not allowed", () => {
    expect(allowed("GPL-3.0-only")).toBe(false);
    expect(allowed("LGPL-2.1-or-later")).toBe(false);
    expect(allowed("NONE")).toBe(false);
    expect(allowed("")).toBe(false);
  });
});

describe("typecheck", () => {
  test("every project `bun run typecheck` checks has isolatedModules, so a type re-exported as a value fails", () => {
    const root = `${import.meta.dir}/../..`;
    const script = readFileSync(`${root}/package.json`, "utf8").match(/"typecheck": "([^"]*)"/)?.[1] ?? "";
    const projects = [...script.matchAll(/-p (\S+)/g)].map((match) => match[1]);
    expect(projects.length).toBeGreaterThan(5);
    for (const project of projects) {
      const config: unknown = Bun.JSONC.parse(readFileSync(`${root}/${project}/tsconfig.json`, "utf8"));
      expect([project, JSON.stringify(config).includes('"isolatedModules":true')]).toEqual([project, true]);
    }
  });
});

describe("bun run check", () => {
  test("the licence notices are a step of their own (as a test they had 2 s, too few under load)", () => {
    const step = STEPS.find((each) => each.command.join(" ") === "bun spin/license-dependencies --check");
    expect(step).toBeDefined();
    // Not in check:fast: it asks Cargo about five trees.
    expect(step?.fast).toBeUndefined();
  });
});
