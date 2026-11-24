#!/usr/bin/env bun
// H21b, every measure is a token (docs/design.html TK-1, TY-3; docs/conventions.md "Hard rules"):
// no literal size, line height, spacing, radius, opacity, weight or shadow in a style. A measure is a
// token from `@dashi/ui`'s theme (`TYPE`, `WEIGHT`, `SPACE`, `RADIUS`, `SHADOW`, `OPACITY`), or a
// component's own measure, a named constant beside it in `@dashi/ui` (a SCREAMING_CASE `const` at the
// file's top level: `MENU.padding`, `ROW_HEIGHT`). Outside the kit a named constant is still a literal.
// Fine everywhere (decisions.md D680): 0 and "auto" (no measure), a percentage (a share, not a
// measure), a 1 px hairline's offset (spacing ±1), a negated token or constant (`-SPACE.xs`), and
// arithmetic on a name (`KNOB / 2`). Timers (`…Ms`, setTimeout's delay) are named constants of their
// module, not style measures: H21b leaves them alone. Counted per file (scripts/design-scan.ts reads
// the literals), each file on its workstream's list, scripts/lists/h21b/<W>.txt, and the lists only
// shrink.
// Run: bun scripts/check-design-measures.ts [--shrink] [--list]

import { countByFile } from "./check-design-values.ts";
import { byWorkstream, listedCounts } from "./design-lists.ts";
import { type Category, type Hit, isScanned, scanText } from "./design-scan.ts";
import { read, repoFiles, report } from "./ratchet.ts";

export const HEADER = [
  "# H21b (scripts/check-design-measures.ts): literal measures in a style (size, line height, spacing,",
  "# radius, opacity, weight, shadow), per file. Shrink-only: use the token, or a named constant beside",
  "# the component in @dashi/ui, then `bun scripts/check-design-measures.ts --shrink`.",
];

const KIT = "packages/dashi-ui/src/";
const MEASURES: ReadonlySet<Category> = new Set(["fontSize", "lineHeight", "spacing", "radius", "opacity", "weight", "shadow"]);

/** H21b: a measure written as a literal where it should be a token or the kit's named constant. */
export function isRawMeasure(hit: Hit): boolean {
  if (!MEASURES.has(hit.category)) return false;
  if (hit.named && hit.file.startsWith(KIT)) return false;
  const value = hit.value;
  if (value === "auto" || value.endsWith("%")) return false;
  // A negated token or constant, `-SPACE.xs`: the negative step.
  if (/^-\s*[A-Za-z_]/.test(value)) return false;
  if (hit.category === "spacing" && Math.abs(Number(value)) === 1) return false;
  return true;
}

/** H21b's hits in these files. */
export function rawMeasures(files: readonly string[], text: (file: string) => string = read): Hit[] {
  return files.filter(isScanned).flatMap((file) => scanText(file, text(file)).filter(isRawMeasure));
}

if (import.meta.main) {
  const hits = rawMeasures(repoFiles());
  if (process.argv.includes("--list")) for (const hit of hits) console.log(`${hit.file}:${hit.line}\t${hit.category}\t${hit.value}`);
  const outcomes = byWorkstream("h21b", countByFile(hits), "literal measures", HEADER);
  console.log(`check-design-measures: ${hits.length} literal measures; files listed per workstream: ${listedCounts(outcomes)}`);
  report("check-design-measures", outcomes);
}
