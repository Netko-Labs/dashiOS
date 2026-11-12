#!/usr/bin/env bun
// Keep a list entry when its file moves (docs/conventions.md, "The lists"). Every list in
// scripts/lists/ is keyed by path, so `git mv a b` would otherwise ask for a hand edit.
//
//   bun scripts/list-rename.ts              carry the entries of every rename git can see
//   bun scripts/list-rename.ts OLD NEW      carry one entry, for a move git did not see
//
// Each entry moves to the new path at the same count; a later --shrink lowers it. An entry
// is never added, and one whose new path is already listed stays where it is.
// `bun scripts/<check>.ts --shrink` does the same for its own list.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { carryRenames, readList, writeList } from "./ratchet.ts";
import { gitRenames } from "./renames.ts";

const LISTS = fileURLToPath(new URL("./lists/", import.meta.url));

/** Carry renames through every list file; returns "list: old -> new" lines. */
export function carryAll(moved: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const file of readdirSync(LISTS).filter((name) => name.endsWith(".txt"))) {
    const name = file.slice(0, -".txt".length);
    const { header, entries } = readList(name);
    const carried = carryRenames(entries, undefined, moved);
    if (carried.size === 0) continue;
    writeList(name, header, entries);
    for (const [from, to] of carried) lines.push(`${name}: ${from} -> ${to}`);
  }
  return lines;
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (args.length !== 0 && args.length !== 2) {
    console.error("usage: bun scripts/list-rename.ts [OLD NEW]");
    process.exit(2);
  }
  const moved = args.length === 2 ? new Map([[args[0] as string, args[1] as string]]) : gitRenames();
  const lines = carryAll(moved);
  console.log(lines.length === 0 ? "list-rename: nothing to carry" : lines.join("\n"));
}
