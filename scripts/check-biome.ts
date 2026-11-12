#!/usr/bin/env bun
// The Biome hard rule's list (docs/conventions.md, "Hard rules"). Biome itself
// enforces the rule in `bun run fmt-lint`; this keeps its exceptions honest.
//   H5  import-cycles   no import cycles. Today's cycles carry a
//                       `biome-ignore lint/nursery/noImportCycles` comment;
//                       Biome fails on a stale one, and the list counts them
//                       per file, so no new one may be added.
// H3 (long functions) is scripts/check-structure.ts's: Biome's count is short.
// Run: bun scripts/check-biome.ts [--shrink]

import { type Counts, type Outcome, ratchet, read, repoFiles, report } from "./ratchet.ts";

const CYCLE_IGNORE = /biome-ignore lint\/nursery\/noImportCycles/g;

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
  return [ratchet("import-cycles", cycleIgnores(repoFiles()), "import cycles let through")];
}

if (import.meta.main) report("check-biome", checkBiome());
