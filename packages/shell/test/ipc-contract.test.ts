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
