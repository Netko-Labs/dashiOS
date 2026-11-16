/**
 * Dashi's own launcher extensions (`packages/shell/extensions/<name>/`:
 * Emoji, GitHub), written on the same API as anyone's
 * (docs/launcher-extensions.md) and run the same way: installed in the
 * person's applets folder, in the sandbox, with their manifest's permissions.
 * At start the shell builds each one whose source changed (Bun.build, a
 * fraction of a second) and installs it as Dashi's (`firstParty` in
 * install.json, consent given: it is part of Dashi, as its own commands are).
 * Nothing is fetched; nothing generated is committed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { consentNames, type InstallRecord, isRefusal, type Manifest, parseRecord, readManifest, SDK_VERSION, writeRecord } from "@dashi/applet";

/** Where Dashi's own extensions' source is, beside the shell's. */
export const FIRST_PARTY_SOURCE = fileURLToPath(new URL("../../extensions/", import.meta.url));

/** Every source file under `dir`, sorted, relative. */
function sourceFiles(dir: string, base = dir): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path, base);
      return /\.(tsx?|json|svg|png)$/.test(name) ? [relative(base, path)] : [];
    });
}

/** What the installed copy is built from: its files and the SDK's version. A change rebuilds it. */
export function sourceHash(dir: string): string {
  const hash = createHash("sha256").update(SDK_VERSION);
  for (const file of sourceFiles(dir))
    hash
      .update(file)
      .update("\0")
      .update(readFileSync(join(dir, file)))
      .update("\0");
  return hash.digest("hex");
}

/** The installed record of a first-party extension: Dashi's, everything it asks for allowed. */
export function firstPartyRecord(manifest: Manifest, sha256: string): InstallRecord {
  return { version: manifest.version, sha256, authorKey: null, source: "local", consent: consentNames(manifest), firstParty: true };
}

/** Builds and installs one extension from `dir` into `root`, unless what is installed was built from the same source. */
export async function installFirstParty(dir: string, root: string): Promise<"installed" | "current" | string> {
  const manifestText = readFileSync(join(dir, "applet.json"), "utf8");
  const manifest = readManifest(manifestText);
  if (isRefusal(manifest)) return `${dir}: ${manifest.error}`;
  const sha256 = sourceHash(dir);
  const target = join(root, manifest.id);
  const installed = existsSync(join(target, "install.json")) ? parseRecord(readFileSync(join(target, "install.json"), "utf8")) : null;
  // One the person installed from elsewhere under the same id is theirs: left alone.
  if (installed && !installed.firstParty) return "current";
  if (installed?.sha256 === sha256 && existsSync(join(target, "main.js"))) return "current";
  const staging = `${target}.building`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const built = await Bun.build({
    entrypoints: [join(dir, manifest.entry)],
    target: "bun",
    outdir: staging,
    naming: "main.js",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!built.success) {
    rmSync(staging, { recursive: true, force: true });
    return `${manifest.id}: ${built.logs.map((log) => String(log)).join("; ")}`;
  }
  writeFileSync(join(staging, "applet.json"), manifestText);
  if (manifest.icon) writeFileSync(join(staging, manifest.icon), readFileSync(join(dir, manifest.icon)));
  writeRecord(staging, firstPartyRecord(manifest, sha256));
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  return "installed";
}

/** Every first-party extension, installed or brought up to date; what went wrong is logged. */
export async function installAllFirstParty(root: string, source: string = FIRST_PARTY_SOURCE): Promise<void> {
  if (!existsSync(source)) return;
  mkdirSync(root, { recursive: true });
  for (const name of readdirSync(source).sort()) {
    const dir = join(source, name);
    if (!existsSync(join(dir, "applet.json"))) continue;
    try {
      const done = await installFirstParty(dir, root);
      if (done !== "installed" && done !== "current") console.error(`dashi-shell: first-party extension: ${done}`);
    } catch (error) {
      console.error(`dashi-shell: first-party extension ${name}:`, error);
    }
  }
}
