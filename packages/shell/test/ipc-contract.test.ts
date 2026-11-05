import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "../../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Two requests the shell sent went unanswered for a whole release: every
// method the shell and the greeter send must be one dashi-comp answers.
test("every IPC method the shell sends is one the compositor handles", () => {
  const handled = new Set(
    [...readFileSync(join(repo, "crates/dashi-comp/src/ipc/requests.rs"), "utf8").matchAll(/^ {8}"([a-z-]+)" =>/gm)].map((match) => match[1]),
  );
  const sent = new Set<string>();
  for (const dir of ["packages/shell/src", "packages/shell/apps", "packages/greeter/src"]) {
    for (const file of sources(join(repo, dir))) {
      for (const match of readFileSync(file, "utf8").matchAll(/\b(?:request|send)\("([a-z-]+)"/g)) sent.add(match[1] ?? "");
    }
  }
  expect(sent.size).toBeGreaterThan(20);
  expect([...sent].filter((method) => !handled.has(method)).sort()).toEqual([]);
});

// The live pictures, the edge hold, and the overview's drag (0.4.0): the
// compositor's side, the doc, and the shell's parser move together.
const rustSources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return rustSources(path);
    return name.endsWith(".rs") ? [path] : [];
  });

test("the pictures' requests are answered and documented", () => {
  const requests = readFileSync(join(repo, "crates/dashi-comp/src/ipc/requests.rs"), "utf8");
  const doc = readFileSync(join(repo, "docs/compositor-ipc.md"), "utf8");
  for (const method of ["space-previews", "window-thumbnails"]) {
    expect(requests).toContain(`        "${method}" =>`);
    expect(doc).toContain(`| \`${method}\` |`);
  }
});

test("every event dashi-comp emits is documented and parsed by the shell", () => {
  const emitted = new Set<string>();
  for (const file of rustSources(join(repo, "crates/dashi-comp/src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(/\.emit\(\s*"([a-z-]+)"/g)) emitted.add(match[1] ?? "");
  }
  expect([...emitted]).toEqual(expect.arrayContaining(["edge-hold", "overview-drag", "overview-drop", "window-space"]));
  const doc = readFileSync(join(repo, "docs/compositor-ipc.md"), "utf8");
  expect([...emitted].filter((name) => !doc.includes(`| \`${name}\` |`)).sort()).toEqual([]);
  const shell = readFileSync(join(repo, "packages/shell/src/compositor.ts"), "utf8");
  expect([...emitted].filter((name) => !shell.includes(`case "${name}":`)).sort()).toEqual([]);
});
