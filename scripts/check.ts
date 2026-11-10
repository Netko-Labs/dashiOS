#!/usr/bin/env bun
// `bun run check`: every check of docs/conventions.md's "Hard rules", in one
// command, the same one CI runs. `bun run check:fast` is the quick subset the
// pre-push hook runs (.githooks/pre-push). Every step runs; the summary lists
// each with its exit code, and the run fails if any step failed.
// Run: bun scripts/check.ts [--fast]

import { ROOT } from "./ratchet.ts";

interface Step {
  name: string;
  command: string[];
  /** In `check:fast` too. */
  fast?: boolean;
  cwd?: string;
}

const TERM = "crates/dashi-term";

export const STEPS: Step[] = [
  { name: "whitespace (git diff --check)", command: ["git", "diff", "--check", "HEAD"], fast: true },
  { name: "H14 repo (tools/check-repo)", command: ["tools/check-repo"], fast: true },
  { name: "H3 H5 lint and format (biome)", command: ["bun", "run", "fmt-lint"], fast: true },
  { name: "H3 H5 lists (check-biome)", command: ["bun", "scripts/check-biome.ts"], fast: true },
  { name: "H2 H4 H6 H11 structure", command: ["bun", "scripts/check-structure.ts"], fast: true },
  { name: "H18 H19 H20 modules", command: ["bun", "scripts/check-modules.ts"], fast: true },
  { name: "H7 H8 H10 boundaries", command: ["bun", "scripts/check-boundaries.ts"], fast: true },
  { name: "H13 shell scripts", command: ["bun", "scripts/check-shell.ts"], fast: true },
  { name: "H16 boot weight", command: ["bun", "scripts/boot-weight.ts"], fast: true },
  { name: "entry weight (the modules each entry loads)", command: ["bun", "scripts/entry-weight.ts", "--check"], fast: true },
  { name: "typecheck (isolatedModules)", command: ["bun", "run", "typecheck"], fast: true },
  { name: "cargo fmt", command: ["cargo", "fmt", "--all", "--check"], fast: true },
  { name: "cargo fmt (dashi-term)", command: ["cargo", "fmt", "--check"], cwd: TERM, fast: true },
  { name: "H15 licences", command: ["bun", "scripts/check-licenses.ts"] },
  { name: "H17 system units", command: ["bun", "scripts/check-units.ts"] },
  { name: "tests (bun; H9 contract)", command: ["bun", "run", "test"] },
  { name: "H12 clippy", command: ["cargo", "clippy", "--workspace", "--all-targets", "--locked", "--", "-D", "warnings"] },
  { name: "H12 clippy (dashi-term)", command: ["cargo", "clippy", "--all-targets", "--locked", "--", "-D", "warnings"], cwd: TERM },
  { name: "cargo test (H9 fixtures)", command: ["cargo", "test", "--workspace", "--locked"] },
  { name: "cargo test (dashi-term)", command: ["cargo", "test", "--locked"], cwd: TERM },
];

async function main(): Promise<void> {
  const fast = process.argv.includes("--fast");
  const steps = STEPS.filter((step) => !fast || step.fast);
  const results: { name: string; code: number; seconds: number }[] = [];
  for (const step of steps) {
    console.log(`\n── ${step.name}: ${step.command.join(" ")}${step.cwd ? ` (in ${step.cwd})` : ""}`);
    const started = performance.now();
    const run = Bun.spawn(step.command, { cwd: `${ROOT}/${step.cwd ?? ""}`, stdout: "inherit", stderr: "inherit" });
    const code = await run.exited;
    results.push({ name: step.name, code, seconds: (performance.now() - started) / 1000 });
  }
  console.log(`\n${fast ? "check:fast" : "check"} summary`);
  for (const result of results) console.log(`  ${result.code === 0 ? "ok  " : "FAIL"} exit ${result.code}  ${result.seconds.toFixed(1)}s  ${result.name}`);
  const failed = results.filter((result) => result.code !== 0).length;
  console.log(failed === 0 ? "all passed" : `${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
