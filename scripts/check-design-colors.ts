#!/usr/bin/env bun
// H23, colours keep their one job (docs/design.html CO-1, CO-2, CO-10, CO-13, KB-2). Line by line,
// in the files the design checks read (scripts/design-scan.ts), outside comments:
//   accent-in-place   the person's accent (selection and its steps, accentInk, textSelection,
//                     useAccent()) in a place it never paints: widgets, the lock screen, Glance, the
//                     login screen
//   purple-off-job    the agents' purple (agent, agentInk, agentWash, focusRing, focus, #6E56CF) as
//                     a fill, an edge or words outside the agents' own modules. The keyboard's ring
//                     is Metal's (focusRingColor), and a field's own edge is its focusBorderColor: a
//                     style that sets focusBorderColor may colour its border the same
//   accent-decor      the accent as a decoration: a logo, a chart, a level, an avatar
//   accent-words      words in the accent's fill (`selection`): a link is ink, a chosen word accentInk
//   foreign-palette   another platform's system colours outside the GTK bridge
// Each hit counts against its file, on its workstream's list, scripts/lists/h23/<W>.txt, which only
// shrinks: once the 0.10 workstreams land, every list is empty and any hit fails.
// Run: bun scripts/check-design-colors.ts [--shrink] [--list]

import { byWorkstream, listedCounts } from "./design-lists.ts";
import { isScanned } from "./design-scan.ts";
import { type Counts, read, repoFiles, report } from "./ratchet.ts";

export type ColorJob = "accent-in-place" | "purple-off-job" | "accent-decor" | "accent-words" | "foreign-palette";

export interface ColorHit {
  file: string;
  line: number;
  job: ColorJob;
  code: string;
}

const ACCENT = /\b(selection|selectionWash|selectionBar|accentInk|textSelection|selectionHover|selectionPressed)\b|useAccent\(/;
const NO_ACCENT = [
  ...["packages/shell/src/widgets/", "packages/shell/src/lock/", "packages/greeter/src/"],
  ...["packages/dashi-ui/src/login-screen.tsx", "packages/shell/src/shared/inks/"],
];
const PURPLE = /\b(backgroundColor|borderColor|color)\s*[:=]\s*\{?\s*[\w.]*\b(agent|agentInk|agentWash|focusRing|focus)\b(?!Ring)|#6e56cf/i;
/** The agents' own modules, and the theme, where purple is at home. */
const AGENT_MODULES = [
  ...["agents", "agent-", "agent_", "capsule", "consent", "/launcher/lib/talk", "menubar", "persona", "voice", "alone-chip"],
  ...["approval", "confirm-sheet", "agents-panel", "pill", "boot/lib/launcher-view", "theme/", "settings-app/lib/panes/agents"],
  ...["settings-app/lib/sidebar-pill", "setup/lib/pages/agents", "launcher/lib/row-view", "handoff"],
];
const DECOR =
  /(Svg[^>]*markup=\{(LOGO|[A-Z_]*CHART|draw\w*|level\w*)[^>]*color=\{[\w.]*\.(selection|accentInk)\}|markup=\{draw\w*\([^)]*\)[^>]*color=\{colors\.selection\})/;
const AVATAR = /(avatar|AVATAR)[\s\S]{0,400}?backgroundColor:\s*colors\.selection/g;
const WORDS = /<Text[^>]*\bcolor:\s*colors\.selection\b/;
const FOREIGN = /#(30d158|34c759|007aff|ff3b30|ff9500|0a84ff|3584e4)\b/i;
const GTK_BRIDGE = ["packages/shell/src/shared/appearance/gtk-colors.ts", "packages/shell/src/appearance/lib/gtk-css.ts", "packages/dashi-ui/src/theme/"];
/** How far either side of a purple edge to look for the field's own focusBorderColor. */
const FIELD_REACH = 6;

const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

/** H23's hits in one file. */
export function colorJobs(file: string, text: string): ColorHit[] {
  const hits: ColorHit[] = [];
  const lines = text.split("\n");
  const hit = (line: number, job: ColorJob, code: string): void => {
    hits.push({ file, line, job, code: code.trim().slice(0, 110) });
  };
  const fieldEdge = (at: number): boolean => lines.slice(Math.max(0, at - FIELD_REACH), at + FIELD_REACH + 1).some((line) => line.includes("focusBorderColor"));
  const noAccent = NO_ACCENT.some((place) => file.startsWith(place));
  const agents = AGENT_MODULES.some((module) => file.includes(module));
  const bridge = GTK_BRIDGE.some((place) => file.startsWith(place));
  lines.forEach((line, index) => {
    if (isComment(line)) return;
    const at = index + 1;
    if (noAccent && ACCENT.test(line)) hit(at, "accent-in-place", line);
    if (!agents && PURPLE.test(line) && !line.includes("focusRingColor") && !line.includes("focusBorderColor") && !fieldEdge(index))
      hit(at, "purple-off-job", line);
    if (DECOR.test(line)) hit(at, "accent-decor", line);
    if (WORDS.test(line)) hit(at, "accent-words", line);
    if (!bridge && FOREIGN.test(line)) hit(at, "foreign-palette", line);
  });
  for (const match of text.matchAll(AVATAR))
    hit(text.slice(0, (match.index ?? 0) + match[0].length).split("\n").length, "accent-decor", "an avatar on the accent");
  return hits;
}

export function colorHits(files: readonly string[], text: (file: string) => string = read): ColorHit[] {
  return files.filter(isScanned).flatMap((file) => colorJobs(file, text(file)));
}

if (import.meta.main) {
  const hits = colorHits(repoFiles());
  if (process.argv.includes("--list")) for (const each of hits) console.log(`${each.file}:${each.line}\t${each.job}\t${each.code}`);
  const found: Counts = new Map();
  for (const each of hits) found.set(each.file, (found.get(each.file) ?? 0) + 1);
  const header = [
    "# H23 (scripts/check-design-colors.ts): colours off their one job, per file. Shrink-only, to empty:",
    "# fix the code (CO-1, CO-2, CO-10, CO-13, KB-2), then `bun scripts/check-design-colors.ts --shrink`.",
  ];
  const outcomes = byWorkstream("h23", found, "colours off their job", header);
  console.log(`check-design-colors: ${hits.length} off their job; files listed per workstream: ${listedCounts(outcomes)}`);
  report("check-design-colors", outcomes);
}
