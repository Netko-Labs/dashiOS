#!/usr/bin/env bun
// The Biome hard rules' lists (docs/conventions.md, "Hard rules"). Biome itself
// enforces both rules in `bun run fmt-lint`; this keeps their exceptions honest.
//   H3  long-functions  no function over 80 lines (tests exempt). A listed file
//                       has a biome.jsonc override at its longest function, so
//                       nothing in it may grow past that; the list holds the sum
//                       of its over-80 functions' lines, so no new one may join.
//   H5  import-cycles   no import cycles. Today's cycles carry a
//                       `biome-ignore lint/nursery/noImportCycles` comment;
//                       Biome fails on a stale one, and the list counts them
//                       per file, so no new one may be added.
// Run: bun scripts/check-biome.ts [--shrink]

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Counts, type Outcome, ROOT, ratchet, read, readList, repoFiles, report } from "./ratchet.ts";

export const MAX_FUNCTION_LINES = 80;
const BIOME_MAX = 255;
const BEGIN = "// H3 overrides: written by `bun scripts/check-biome.ts --shrink`; do not edit by hand.";
const END = "// H3 overrides end.";
const CYCLE_IGNORE = /biome-ignore lint\/nursery\/noImportCycles/g;

interface Diagnostic {
  category: string;
  description: string;
  location: { path: { file: string } };
}

/** Every function over the limit, measured by Biome with no exceptions. */
export function longFunctions(): Map<string, number[]> {
  const config = Bun.JSONC.parse(read("biome.jsonc")) as { files: unknown };
  const dir = mkdtempSync(join(tmpdir(), "dashi-h3-"));
  try {
    const scratch = {
      files: config.files,
      linter: {
        rules: {
          recommended: false,
          complexity: { noExcessiveLinesPerFunction: { level: "error", options: { maxLines: MAX_FUNCTION_LINES } } },
        },
      },
      overrides: [{ includes: ["**/test/**"], linter: { rules: { complexity: { noExcessiveLinesPerFunction: "off" } } } }],
    };
    writeFileSync(join(dir, "biome.json"), JSON.stringify(scratch));
    const run = Bun.spawnSync(["bun", "x", "biome", "lint", `--config-path=${dir}`, "--reporter=json", "--max-diagnostics=none", "."], { cwd: ROOT });
    const out = JSON.parse(run.stdout.toString()) as { diagnostics: Diagnostic[] };
    const found = new Map<string, number[]>();
    for (const each of out.diagnostics) {
      if (each.category !== "lint/complexity/noExcessiveLinesPerFunction") continue;
      const lines = Number(/\((\d+)\)/.exec(each.description)?.[1]);
      const file = each.location.path.file;
      found.set(file, [...(found.get(file) ?? []), lines]);
    }
    return found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The overrides block biome.jsonc must hold for a list (Biome then formats it). */
export function overridesBlock(maxima: Counts): string {
  const entries = [...maxima].sort().map(([file, max]) => {
    // Biome takes at most 255 here; past that, the list's sum alone holds the file.
    const rule = max > BIOME_MAX ? "off" : { level: "error", options: { maxLines: max } };
    return `{ "includes": [${JSON.stringify(file)}], "linter": { "rules": { "complexity": { "noExcessiveLinesPerFunction": ${JSON.stringify(rule)} } } } },`;
  });
  return `${BEGIN}\n${entries.join("\n")}\n${END}`;
}

interface Override {
  includes?: string[];
  linter?: { rules?: { complexity?: { noExcessiveLinesPerFunction?: unknown } } };
}

/** The H3 overrides biome.jsonc holds now: file -> its maxLines (0 for "off"). */
function overridesNow(text: string): Counts {
  const config = Bun.JSONC.parse(text) as { overrides?: Override[] };
  const now: Counts = new Map();
  for (const each of config.overrides ?? []) {
    const rule = each.linter?.rules?.complexity?.noExcessiveLinesPerFunction;
    const [file] = each.includes ?? [];
    if (!file || file.includes("*") || rule === undefined) continue;
    now.set(file, rule === "off" ? 0 : ((rule as { options?: { maxLines?: number } }).options?.maxLines ?? -1));
  }
  return now;
}

function overridesProblems(maxima: Counts): string[] {
  const text = read("biome.jsonc");
  const want: Counts = new Map([...maxima].map(([file, max]) => [file, max > BIOME_MAX ? 0 : max]));
  const now = overridesNow(text);
  const same = now.size === want.size && [...want].every(([file, max]) => now.get(file) === max);
  if (same) return [];
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (process.argv.includes("--shrink") && start >= 0 && end >= 0) {
    writeFileSync(join(ROOT, "biome.jsonc"), text.slice(0, start) + overridesBlock(maxima) + text.slice(end + END.length));
    Bun.spawnSync(["bun", "x", "biome", "format", "--write", "biome.jsonc"], { cwd: ROOT });
    return [];
  }
  return ["biome.jsonc's H3 overrides differ from today's longest functions; run `bun scripts/check-biome.ts --shrink`"];
}

export function cycleIgnores(files: string[]): Counts {
  const found: Counts = new Map();
  for (const file of files) {
    if (!/\.tsx?$/.test(file) || file.startsWith("scripts/")) continue;
    const count = read(file).match(CYCLE_IGNORE)?.length ?? 0;
    if (count > 0) found.set(file, count);
  }
  return found;
}

export function checkBiome(): Outcome[] {
  const measured = longFunctions();
  const sums: Counts = new Map([...measured].map(([file, lines]) => [file, lines.reduce((a, b) => a + b, 0)]));
  const functions = ratchet("long-functions", sums, `lines in functions over ${MAX_FUNCTION_LINES}`);
  const listed = readList("long-functions").entries;
  const maxima: Counts = new Map([...listed.keys()].map((file) => [file, Math.max(MAX_FUNCTION_LINES, ...(measured.get(file) ?? []))]));
  functions.problems.push(...overridesProblems(maxima));
  return [functions, ratchet("import-cycles", cycleIgnores(repoFiles()), "import cycles let through")];
}

if (import.meta.main) report("check-biome", checkBiome());
