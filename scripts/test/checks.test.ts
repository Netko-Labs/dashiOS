// The hard-rule checks' pure parts: what each counts as an offence.
import { describe, expect, test } from "bun:test";
import { ipcMethods } from "../check-boundaries.ts";
import { allowed } from "../check-licenses.ts";
import { barrelExtras, lineCount, specifiers, wrongWay } from "../check-structure.ts";

describe("H2 line count", () => {
  test("counts lines with or without a final newline", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
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
