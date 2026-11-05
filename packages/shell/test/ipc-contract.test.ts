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

// Secrets for agents (0.4.0): the masks and whose presses were whose are
// documented, handled, and sent by the shell, all three.
test("capture-mask and input-origin are in the doc, the compositor, and the shell", () => {
  const doc = readFileSync(join(repo, "docs/compositor-ipc.md"), "utf8");
  const handled = readFileSync(join(repo, "crates/dashi-comp/src/ipc/requests.rs"), "utf8");
  const shell = ["packages/shell/src/agents/mask.ts", "packages/shell/src/agents/person.ts"].map((file) => readFileSync(join(repo, file), "utf8")).join("\n");
  for (const method of ["capture-mask", "input-origin"]) {
    expect(doc).toContain(`| \`${method}\` |`);
    expect(handled).toContain(`"${method}" =>`);
    expect(shell).toContain(`"${method}"`);
  }
  // Every agent capture names its mask.
  for (const file of ["packages/shell/src/agents/run.ts", "packages/shell/src/agents/desktop/record.ts"]) {
    expect(readFileSync(join(repo, file), "utf8")).toContain("mask: AGENT_MASK");
  }
});
