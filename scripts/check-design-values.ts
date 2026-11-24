#!/usr/bin/env bun
// H21a, colours and scales (docs/design.html CO-5, TY-1, TY-2, RA-1, DE-1, TK-1): no hex outside
// packages/dashi-ui/src/theme/; no font size off TY-1's rows, no radius off RA-1, no weight off TY-2
// (a display weight is WEIGHT.display.*, never a literal), no shadow off DE-1. Counted per file
// (scripts/design-scan.ts says what counts), each file on its workstream's list,
// scripts/lists/h21/<W>.txt (scripts/design-lists.ts), and the lists only shrink.
// Run: bun scripts/check-design-values.ts [--shrink] [--list]

import { byWorkstream, listedCounts } from "./design-lists.ts";
import { type Hit, isOffScale, isScanned, scanText } from "./design-scan.ts";
import { type Counts, read, repoFiles, report } from "./ratchet.ts";

export const HEADER = [
  "# H21a (scripts/check-design-values.ts): colours outside the theme and sizes, radii, weights and",
  "# shadows off the scales, per file. Shrink-only: fix the code (the token is in the plan's",
  "# raw-values-mapped.tsv), then `bun scripts/check-design-values.ts --shrink`.",
];

/** H21a's hits in these files. */
export function offScale(files: readonly string[], text: (file: string) => string = read): Hit[] {
  return files.filter(isScanned).flatMap((file) => scanText(file, text(file)).filter(isOffScale));
}

export function countByFile(hits: readonly Hit[]): Counts {
  const found: Counts = new Map();
  for (const hit of hits) found.set(hit.file, (found.get(hit.file) ?? 0) + 1);
  return found;
}

if (import.meta.main) {
  const hits = offScale(repoFiles());
  if (process.argv.includes("--list")) for (const hit of hits) console.log(`${hit.file}:${hit.line}\t${hit.category}\t${hit.value}`);
  const outcomes = byWorkstream("h21", countByFile(hits), "values off the scales", HEADER);
  console.log(`check-design-values: ${hits.length} off the scales; files listed per workstream: ${listedCounts(outcomes)}`);
  report("check-design-values", outcomes);
}
