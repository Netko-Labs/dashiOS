import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dedupeInstalled, singletons } from "../src/singletons.ts";

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** An applet whose dependency brings its own copy of react, nested in its node_modules. */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "applet-singletons-"));
  write(join(dir, "node_modules/react/package.json"), JSON.stringify({ name: "react", main: "index.js" }));
  write(join(dir, "node_modules/react/index.js"), 'export const copy = "the applet\'s";\n');
  write(join(dir, "node_modules/lib/package.json"), JSON.stringify({ name: "lib", main: "index.js" }));
  write(join(dir, "node_modules/lib/index.js"), 'export { copy } from "react";\n');
  write(join(dir, "node_modules/lib/node_modules/react/package.json"), JSON.stringify({ name: "react", main: "index.js" }));
  write(join(dir, "node_modules/lib/node_modules/react/index.js"), 'export const copy = "a nested one";\n');
  write(join(dir, "main.js"), 'import { copy as mine } from "react";\nimport { copy as theirs } from "lib";\nexport const copies = [mine, theirs];\n');
  return dir;
}

async function copies(dir: string, plugins: Parameters<typeof Bun.build>[0]["plugins"]): Promise<string[]> {
  const built = await Bun.build({ entrypoints: [join(dir, "main.js")], target: "bun", format: "esm", plugins });
  expect(built.success).toBe(true);
  // A file per build: an import is cached by its path.
  const out = join(dir, `out-${plugins?.length ?? 0}.js`);
  writeFileSync(out, await (built.outputs[0] as Blob).text());
  return ((await import(out)) as { copies: string[] }).copies;
}

test("a dependency's own copy of react resolves to the applet's", async () => {
  const dir = project();
  try {
    expect(await copies(dir, [])).toEqual(["the applet's", "a nested one"]);
    expect(await copies(dir, [singletons(dir)])).toEqual(["the applet's", "the applet's"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev: the nested copy goes from the applet's node_modules, and the applet's own stays", () => {
  const dir = project();
  try {
    expect(dedupeInstalled(dir)).toEqual(["lib → react"]);
    expect(dedupeInstalled(dir)).toEqual([]);
    expect(Bun.resolveSync("react", join(dir, "node_modules/lib"))).toBe(join(dir, "node_modules/react/index.js"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
