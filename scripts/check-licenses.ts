#!/usr/bin/env bun
// H15 (docs/conventions.md, "Hard rules" and "Licenses"): every dependency in
// bun.lock, Cargo.lock and crates/dashi-term/Cargo.lock has a licence on the
// allowed list, or a choice that includes one. Anything else must be in
// scripts/lists/license-exceptions.txt, an explicit list that may only shrink
// (see scripts/ratchet.ts): a new dependency with another licence fails until
// someone checks it and lists it with the reason in the commit.
// Needs `bun install` (licences come from node_modules) and cargo.
// Run: bun scripts/check-licenses.ts [--shrink]

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type Counts, type Outcome, ROOT, ratchet, read, report } from "./ratchet.ts";

/** docs/conventions.md, "Licenses": permissive, or MPL-2.0 used unmodified as a library. */
export const ALLOWED = new Set(["MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC", "Zlib", "MPL-2.0"]);

/** Whether an SPDX expression is allowed: OR takes any side, AND needs both, WITH keeps the licence. */
export function allowed(expression: string): boolean {
  const tokens = expression.replaceAll("/", " OR ").match(/\(|\)|[^\s()]+/g) ?? [];
  let at = 0;
  const atom = (): boolean => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = or();
      at++; // ")"
      return inner;
    }
    const ok = token !== undefined && ALLOWED.has(token);
    if (tokens[at] === "WITH") at += 2;
    return ok;
  };
  const and = (): boolean => {
    let ok = atom();
    while (tokens[at] === "AND") {
      at++;
      ok = atom() && ok;
    }
    return ok;
  };
  const or = (): boolean => {
    let ok = and();
    while (tokens[at] === "OR") {
      at++;
      ok = and() || ok;
    }
    return ok;
  };
  return tokens.length > 0 && or();
}

type Entry = [id: string, registry: string, meta?: { os?: unknown; cpu?: unknown }];

function npmLicense(json: { license?: unknown; licenses?: unknown }): string {
  if (typeof json.license === "string") return json.license;
  if (json.license && typeof json.license === "object" && "type" in json.license) return String(json.license.type);
  if (Array.isArray(json.licenses)) return json.licenses.map((each) => (typeof each === "string" ? each : String(each?.type))).join(" OR ");
  return "NONE";
}

/** bun.lock's packages and their licences, from Bun's store in node_modules/.bun. */
export async function bunLicenses(): Promise<Map<string, string>> {
  const lock = Bun.JSONC.parse(read("bun.lock")) as { packages: Record<string, Entry> };
  const store = join(ROOT, "node_modules", ".bun");
  const dirs = existsSync(store) ? readdirSync(store) : [];
  const found = new Map<string, string>();
  for (const [id, , meta] of Object.values(lock.packages)) {
    const at = id.lastIndexOf("@");
    const name = id.slice(0, at);
    const version = id.slice(at + 1);
    if (version.startsWith("workspace:")) continue;
    const encoded = id.replaceAll("/", "+").replaceAll(":", "+");
    const dir = dirs.find((each) => each === encoded || each.startsWith(`${encoded}+`));
    if (!dir) {
      // A package for another platform (Biome's binaries) is not installed here.
      if (meta?.os !== undefined || meta?.cpu !== undefined) continue;
      found.set(`bun:${name}`, "NOT INSTALLED (run bun install)");
      continue;
    }
    const json = (await Bun.file(join(store, dir, "node_modules", name, "package.json")).json()) as { license?: unknown };
    found.set(`bun:${name}`, npmLicense(json));
  }
  return found;
}

/** A Cargo workspace's registry and git dependencies and their licences. */
export function cargoLicenses(manifest: string): Map<string, string> {
  const run = Bun.spawnSync(["cargo", "metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], { cwd: ROOT, stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`cargo metadata ${manifest}: ${run.stderr.toString()}`);
  const meta = JSON.parse(run.stdout.toString()) as { packages: { name: string; source: string | null; license: string | null }[] };
  const found = new Map<string, string>();
  for (const each of meta.packages) if (each.source !== null) found.set(`cargo:${each.name}`, each.license ?? "NONE");
  return found;
}

export async function licenseOffenders(): Promise<Counts> {
  const all = new Map([...(await bunLicenses()), ...cargoLicenses("Cargo.toml"), ...cargoLicenses("crates/dashi-term/Cargo.toml")]);
  const found: Counts = new Map();
  for (const [name, license] of all) if (!allowed(license)) found.set(`${name} ${license}`, 1);
  return found;
}

export async function checkLicenses(): Promise<Outcome[]> {
  return [ratchet("license-exceptions", await licenseOffenders(), "licence not on the allowed list")];
}

if (import.meta.main) report("check-licenses", await checkLicenses());
