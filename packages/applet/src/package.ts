/**
 * A .dashi-applet: what the store downloads and the sandbox runs. A gzipped
 * tar (tar.ts) of
 *
 *   applet.json   the manifest
 *   main.js       the entry and everything it imports, bundled by `bun build`
 *   build.json    {"bun": "1.4.4", "sdk": "0.5.0"}: what built it, for the rebuild in CI
 *   assets/…      files the applet reads at run time (its glyphs, its icon)
 *
 * Packing is reproducible: the same source with the same Bun makes the same
 * bytes, which is how the catalog's CI checks that a package is its source.
 * The bundle names each module by its path from the folder the build runs
 * in, so the build runs in the applet's own folder: wherever pack is started
 * from, the author's machine or CI's, the names are the same.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isInsidePath } from "@dashi/shape/kit";
import { type Manifest, readManifest } from "./manifest.ts";
import { singletons } from "./singletons.ts";
import { readTar, writeTar } from "./tar.ts";

export const PACKAGE_EXTENSION = ".dashi-applet";
export const SDK_VERSION = "0.5.0";

export const packageName = (manifest: Pick<Manifest, "id" | "version">): string => `${manifest.id}-${manifest.version}${PACKAGE_EXTENSION}`;

export const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function filesUnder(root: string, dir: string, out: Map<string, Uint8Array>): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = statSync(path);
    const inside = relative(root, path);
    if (!isInsidePath(inside)) continue;
    if (info.isDirectory()) filesUnder(root, path, out);
    else if (info.isFile()) out.set(inside, new Uint8Array(readFileSync(path)));
  }
}

export interface Packed {
  manifest: Manifest;
  name: string;
  bytes: Uint8Array;
  sha256: string;
}

/** The build in flight: a build changes the process's folder while it runs, so one runs at a time. */
let building: Promise<unknown> = Promise.resolve();

/** `Bun.build` of `entry`, run in `dir` (the header says why): after any build before it, so two never swap folders under each other. */
function buildIn(dir: string, entry: string): Promise<Awaited<ReturnType<typeof Bun.build>>> {
  const run = async (): Promise<Awaited<ReturnType<typeof Bun.build>>> => {
    const from = process.cwd();
    process.chdir(dir);
    try {
      return await Bun.build({
        entrypoints: [resolve(dir, entry)],
        target: "bun",
        format: "esm",
        minify: false,
        sourcemap: "none",
        // React and friends in their production builds, whatever the shell running pack has set.
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [singletons(dir)],
      });
    } finally {
      process.chdir(from);
    }
  };
  const built = building.then(run, run);
  building = built.catch(() => {});
  return built;
}

/** Builds the applet in `dir` (its applet.json, its entry) into a package. */
export async function pack(dir: string): Promise<Packed> {
  const manifestPath = join(dir, "applet.json");
  if (!existsSync(manifestPath)) throw new Error(`no applet.json in ${dir}`);
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = readManifest(manifestText);
  if ("error" in manifest) throw new Error(`applet.json: ${manifest.error}`);
  const built = await buildIn(resolve(dir), manifest.entry);
  if (!built.success) throw new Error(`the build failed:\n${built.logs.map((log) => String(log)).join("\n")}`);
  const output = built.outputs.find((each) => each.kind === "entry-point");
  if (!output) throw new Error("the build made no entry point");
  const files = new Map<string, Uint8Array>();
  files.set("applet.json", new TextEncoder().encode(manifestText));
  files.set("main.js", new Uint8Array(await output.arrayBuffer()));
  files.set("build.json", new TextEncoder().encode(`${JSON.stringify({ bun: Bun.version, sdk: SDK_VERSION })}\n`));
  const assets = join(dir, "assets");
  if (existsSync(assets) && statSync(assets).isDirectory()) filesUnder(dir, assets, files);
  const bytes = writeTar(files);
  return { manifest, name: packageName(manifest), bytes, sha256: sha256(bytes) };
}

export interface Unpacked {
  manifest: Manifest;
  files: Map<string, Uint8Array>;
}

/** A package's files and manifest, or why it is refused. Signatures are checked before this (catalog.ts). */
export function unpack(bytes: Uint8Array): Unpacked | { error: string } {
  const files = readTar(bytes);
  if ("error" in files) return files;
  const manifestBytes = files.get("applet.json");
  if (!manifestBytes) return { error: "the package has no applet.json" };
  if (!files.has("main.js")) return { error: "the package has no main.js" };
  const manifest = readManifest(new TextDecoder().decode(manifestBytes));
  if ("error" in manifest) return { error: `applet.json: ${manifest.error}` };
  const stray = [...files.keys()].find((name) => !["applet.json", "main.js", "build.json"].includes(name) && !name.startsWith("assets/"));
  if (stray) return { error: `the package holds ${stray}, which is not an applet's` };
  return { manifest, files };
}
