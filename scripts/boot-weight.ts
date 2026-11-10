#!/usr/bin/env bun
// H16 (docs/conventions.md, "Hard rules"): heavy libraries never load at shell
// start, and the start-up module count has a ceiling.
//
// Bun bundles the shell's entry (packages/shell/src/main.tsx) with code
// splitting; the start-up graph is the entry chunk and every chunk it imports
// statically. A dynamic `import()` is not start-up.
//
// scripts/lists/boot-weight.txt holds:
//   <n>  startup-modules       the ceiling: fail above it, and fail when the
//                              count is more than SLACK under it (lower it)
//   <n>  banned:<package>      a banned package's modules at start, a ratchet
//                              (scripts/ratchet.ts): may only shrink to gone
// Run: bun scripts/boot-weight.ts [--shrink]

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Counts, type Outcome, ROOT, ratchet, readList, report } from "./ratchet.ts";

const ENTRY = "packages/shell/src/main.tsx";
/** Packages that must never load at start: the AI answerers' SDKs. */
export const BANNED = ["openai", "@anthropic-ai/sdk"];
const CEILING_KEY = "startup-modules";
/** How far under the ceiling the count may fall before the ceiling must come down. */
export const SLACK = 50;

interface Output {
  entryPoint?: string;
  inputs: Record<string, unknown>;
  imports?: { path: string; kind: string }[];
}

/** The modules Bun loads before main.tsx runs. */
export async function startupModules(): Promise<string[]> {
  const outdir = mkdtempSync(join(tmpdir(), "dashi-boot-weight-"));
  try {
    const built = await Bun.build({
      entrypoints: [join(ROOT, ENTRY)],
      root: ROOT,
      target: "bun",
      format: "esm",
      splitting: true,
      metafile: true,
      outdir,
      throw: false,
    });
    if (!built.success || !built.metafile) throw new Error(`bundling ${ENTRY} failed: ${built.logs.join("\n")}`);
    const outputs = built.metafile.outputs as Record<string, Output>;
    const name = (path: string): string => path.replace(/^\.\//, "");
    const byName = new Map(Object.entries(outputs).map(([path, output]) => [name(path), output]));
    const start = [...byName].find(([, output]) => output.entryPoint?.endsWith(ENTRY))?.[0];
    if (!start) throw new Error("no entry chunk in the bundle");
    const seen = new Set<string>();
    const modules = new Set<string>();
    const walk = (chunk: string): void => {
      const output = byName.get(chunk);
      if (!output || seen.has(chunk)) return;
      seen.add(chunk);
      for (const input of Object.keys(output.inputs)) modules.add(input);
      for (const each of output.imports ?? []) if (each.kind !== "dynamic-import") walk(name(each.path));
    };
    walk(start);
    return [...modules];
  } finally {
    rmSync(outdir, { recursive: true, force: true });
  }
}

export function bannedCounts(modules: string[]): Counts {
  const found: Counts = new Map();
  for (const banned of BANNED) {
    const pattern = new RegExp(`node_modules/(?:\\.bun/[^/]+/node_modules/)?${banned.replace("/", "\\/")}/`);
    const count = modules.filter((module) => pattern.test(module)).length;
    if (count > 0) found.set(`banned:${banned}`, count);
  }
  return found;
}

export async function checkBootWeight(): Promise<Outcome[]> {
  const modules = await startupModules();
  const ceiling = readList("boot-weight").entries.get(CEILING_KEY);
  const problems: string[] = [];
  let kept = ceiling ?? 0;
  if (ceiling === undefined) problems.push(`scripts/lists/boot-weight.txt has no ${CEILING_KEY} line`);
  else if (modules.length > ceiling) problems.push(`the shell loads ${modules.length} modules at start, over the ceiling of ${ceiling}`);
  else if (modules.length < ceiling - SLACK) {
    if (process.argv.includes("--shrink")) kept = modules.length;
    else problems.push(`the shell loads ${modules.length} modules at start, ${ceiling - modules.length} under the ceiling: lower it (or run with --shrink)`);
  }
  // The ceiling rides in the list as one more key, so the ratchet keeps (or lowers) it.
  const found = bannedCounts(modules);
  if (ceiling !== undefined) found.set(CEILING_KEY, kept);
  const banned = ratchet("boot-weight", found, "modules at shell start");
  return [{ name: `startup modules ${modules.length}, ceiling ${ceiling}`, problems, listed: 1 }, banned];
}

if (import.meta.main) report("boot-weight", await checkBootWeight());
