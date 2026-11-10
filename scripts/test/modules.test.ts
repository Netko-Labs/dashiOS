// H18 to H20 (scripts/check-modules.ts) on a small made-up tree, and the move tool's rewrite.
import { describe, expect, test } from "bun:test";
import { deepImports, entryPaths, libImports, reExportCount, sharedUse } from "../check-modules.ts";
import { againstBaseline, compare, formatBaseline, movedModule, parseBaseline, runtimeSpecifiers } from "../entry-weight.ts";
import type { Graph } from "../modules.ts";
import { crossedModule, libOwner, moduleChain, topModule } from "../modules.ts";
import { literalFor, parsePairs, rewrite } from "../move.ts";

const S = "packages/shell/src";
const A = "packages/shell/apps";

/** A graph from `file: [targets]`. */
function graph(edges: Record<string, string[]>): Graph {
  const imports = new Map(Object.entries(edges));
  for (const targets of Object.values(edges)) for (const target of targets) if (!imports.has(target)) imports.set(target, []);
  return { files: [...imports.keys()], imports };
}

describe("modules", () => {
  test("a module is a folder in src, a shared concern, an app, or a package's src folder", () => {
    expect(topModule(`${S}/menus/lib/view.tsx`)).toBe(`${S}/menus`);
    expect(topModule(`${S}/shared/dbus/bus.ts`)).toBe(`${S}/shared/dbus`);
    expect(topModule(`${S}/shared/loose.ts`)).toBeNull();
    expect(topModule(`${A}/calendar/main.tsx`)).toBe(`${A}/calendar`);
    expect(topModule(`${S}/apps.ts`)).toBeNull();
    expect(topModule("packages/applet/src/signing/keys.ts")).toBe("packages/applet/src/signing");
    expect(topModule("packages/shell/test/x.test.ts")).toBeNull();
  });
  test("a folder with its own index.ts is a nested module, never inside lib/", () => {
    const known = new Set([`${S}/agents/ask/index.ts`, `${S}/agents/lib/x/index.ts`]);
    expect(moduleChain(`${S}/agents/ask/lib/http.ts`, known)).toEqual([`${S}/agents`, `${S}/agents/ask`]);
    expect(moduleChain(`${S}/agents/lib/x/y.ts`, known)).toEqual([`${S}/agents`]);
    expect(crossedModule(`${S}/agents/handoff/a.ts`, `${S}/agents/ask/service.ts`, known)).toBe(`${S}/agents/ask`);
    expect(crossedModule(`${S}/main.tsx`, `${S}/agents/ask/service.ts`, known)).toBe(`${S}/agents`);
    expect(crossedModule(`${S}/agents/ask/a.ts`, `${S}/agents/ask/b.ts`, known)).toBeNull();
  });
  test("lib/ belongs to the folder that holds it", () => {
    expect(libOwner(`${S}/menus/lib/view.tsx`)).toBe(`${S}/menus`);
    expect(libOwner(`${S}/agents/ask/lib/grid/a.ts`)).toBe(`${S}/agents/ask`);
    expect(libOwner(`${S}/menus/view.tsx`)).toBeNull();
  });
});

describe("H18 lib imports", () => {
  test("only the owner's files and tests import a lib/", () => {
    const found = libImports(
      graph({
        [`${S}/menus/start.tsx`]: [`${S}/menus/lib/view.tsx`],
        [`${S}/dock/view.tsx`]: [`${S}/menus/lib/view.tsx`],
        [`${S}/agents/handoff/a.ts`]: [`${S}/agents/ask/lib/http.ts`],
        "packages/shell/test/view.test.tsx": [`${S}/menus/lib/view.tsx`],
      }),
    );
    expect([...found]).toEqual([
      [`${S}/dock/view.tsx`, 1],
      [`${S}/agents/handoff/a.ts`, 1],
    ]);
  });
  test("finds lib/ paths in exports and bin", () => {
    expect(entryPaths({ exports: { ".": "./src/index.ts", "./x": "./src/lib/x.ts" }, bin: { a: "./src/lib/main.ts" }, main: "./lib/y.ts" })).toEqual([
      "./src/index.ts",
      "./src/lib/x.ts",
      "./src/lib/main.ts",
    ]);
  });
});

describe("H19 deep imports", () => {
  test("from outside, the index or a file it re-exports; tests may also reach lib/", () => {
    const found = deepImports(
      graph({
        [`${S}/menus/index.ts`]: [`${S}/menus/model.ts`, `${S}/menus/lib/start.tsx`],
        [`${S}/menus/model.ts`]: [`${S}/menus/lib/view.tsx`],
        [`${S}/menus/sheets.tsx`]: [],
        [`${S}/dock/a.ts`]: [`${S}/menus/index.ts`, `${S}/menus/model.ts`, `${S}/menus/sheets.tsx`, `${S}/menus/lib/start.tsx`],
        "packages/shell/test/a.test.ts": [`${S}/menus/lib/view.tsx`, `${S}/menus/sheets.tsx`],
        [`${S}/apps.ts`]: [`${S}/menubar.tsx`],
      }),
    );
    expect(Object.fromEntries(found)).toEqual({ "packages/shell/test/a.test.ts": 1, [`${S}/dock/a.ts`]: 2 });
  });
});

describe("H19 re-exports", () => {
  test("counts `export … from`, not a local export", () => {
    const text = 'export { a } from "./a.ts";\nexport type { B } from "./b.ts";\nexport * from "./c.ts";\nexport const d = 1;\nexport { d as e };\n';
    expect(reExportCount("x.ts", text)).toBe(3);
  });
});

describe("H20 shared use", () => {
  test("a concern needs two users; loose files and catch-alls count", () => {
    const found = sharedUse(
      graph({
        [`${S}/dock/a.ts`]: [`${S}/shared/time/index.ts`, `${S}/shared/fs/index.ts`, `${S}/shared/utils/a.ts`],
        [`${A}/notes/a.ts`]: [`${S}/shared/time/clock.ts`, `${S}/shared/utils/a.ts`],
        "packages/shell/test/a.test.ts": [`${S}/shared/fs/index.ts`],
        [`${S}/shared/loose.ts`]: [],
      }),
    );
    expect(Object.fromEntries(found)).toEqual({
      [`${S}/shared/fs`]: 1,
      [`${S}/shared/utils`]: 2,
      [`${S}/shared/loose.ts`]: 2,
    });
  });
});

describe("move", () => {
  test("names a target the way it was named", () => {
    expect(literalFor(`${S}/dock/a.ts`, `${S}/menus/lib/view.tsx`, "")).toBe("../menus/lib/view.tsx");
    expect(literalFor(`${S}/menus/a.ts`, `${S}/menus/lib/view.tsx`, ".tsx")).toBe("./lib/view");
  });
  test("rewrites importers and the moved file itself", () => {
    const moves = parsePairs([`${S}/menus/view.tsx`, `${S}/menus/lib/`]);
    const exists = (file: string): boolean => [`${S}/menus/view.tsx`, `${S}/menus/model.ts`].includes(file);
    const importer = 'import { a } from "../menus/view.tsx";\nmock.module("../menus/view.tsx", () => ({}));\n';
    expect(rewrite(importer, `${S}/dock/a.ts`, `${S}/dock/a.ts`, moves, exists)).toBe(
      'import { a } from "../menus/lib/view.tsx";\nmock.module("../menus/lib/view.tsx", () => ({}));\n',
    );
    const moved = 'import { b } from "./model.ts";\n';
    expect(rewrite(moved, `${S}/menus/view.tsx`, `${S}/menus/lib/view.tsx`, moves, exists)).toBe('import { b } from "../model.ts";\n');
  });
});

describe("entry weight", () => {
  test("follows what a file loads when it runs: no type-only or dynamic imports", () => {
    const text =
      'import type { A } from "./a.ts";\nimport { type B } from "./b.ts";\nimport { c, type C } from "./c.ts";\nexport type { D } from "./d.ts";\nexport { e } from "./e.ts";\nconst f = await import("./f.ts");\n';
    expect(runtimeSpecifiers("x.ts", text)).toEqual(["./c.ts", "./e.ts"]);
  });
  test("an entry that loads a module it did not load before grew", () => {
    const weight = (...modules: string[]) => ({ files: modules.length, modules: new Set(modules) });
    const before = new Map([["main.tsx", weight("menus", "dock")]]);
    expect([...compare(new Map([["main.tsx", weight("menus", "dock")]]), before)]).toEqual([]);
    expect([...compare(new Map([["main.tsx", weight("menus", "dock", "agents")]]), before)]).toEqual([["main.tsx", ["agents"]]]);
  });
});

describe("entry weight follows moves", () => {
  const exists = (path: string) => ["src/menubar/menubar.tsx", "src/menus", "src/dock"].includes(path);
  const moved = new Map([
    ["src/menubar.tsx", "src/menubar/menubar.tsx"],
    ["src/menu/model.ts", "src/menus/model.ts"],
  ]);
  test("a file moved into a folder, or a folder renamed, is the module it is in now", () => {
    expect(movedModule("src/dock", moved, exists)).toBe("src/dock");
    expect(movedModule("packages/shell/src/x.ts", new Map(), () => false)).toBe("packages/shell/src/x.ts");
    expect(
      movedModule(
        "packages/shell/src/menubar.tsx",
        new Map([["packages/shell/src/menubar.tsx", "packages/shell/src/menubar/menubar.tsx"]]),
        (p) => p === "packages/shell/src/menubar/menubar.tsx",
      ),
    ).toBe("packages/shell/src/menubar");
  });
  test("a regrouped module is not a new one, against a ref or the baseline", () => {
    const weight = (...modules: string[]) => ({ files: modules.length, modules: new Set(modules) });
    const rename = (module: string) => (module === "loose.tsx" ? "folder" : module);
    expect([...compare(new Map([["main.tsx", weight("folder", "dock")]]), new Map([["main.tsx", weight("loose.tsx", "dock")]]), rename)]).toEqual([]);
    const base = parseBaseline("# header\nmain.tsx\tloose.tsx\nmain.tsx\tdock\nold.ts\tdock\n");
    expect(againstBaseline(new Map([["main.tsx", weight("folder", "dock", "agents")]]), base, rename)).toEqual({
      grown: ["main.tsx loads agents"],
      stale: ["old.ts is no entry point now"],
    });
    expect(
      formatBaseline(new Map([["b", new Set(["y", "x"])]]))
        .split("\n")
        .slice(1),
    ).toEqual(["b\tx", "b\ty", ""]);
  });
});
