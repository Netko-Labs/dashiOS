#!/usr/bin/env bun
/**
 * dashi-browser-pack: build Dashi's browser extension (browser-extension/)
 * into what the dashi-helium package installs: the CRX, signed with the
 * extension's key, and the update manifest the browser's policy points at.
 *
 *   bun bin/dashi-browser-pack.ts --key <private.pem> --out <dir> [--base file:///usr/share/dashi/browser]
 *
 * The key must be the one whose public half is the manifest's `key`: the
 * extension's id (which the native host's manifest allows) comes from it.
 * It is never in the repository (docs/actions.md, "Websites"); spin/build-rpms
 * passes $DASHI_EXTENSION_KEY, by default ~/.config/dashi-build/browser-extension.pem.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isRecord, must, obj, str } from "@dashi/shape";
import { crx3, extensionId, idFromManifestKey, publicDer, updateManifest, zip } from "../src/browser/crx.ts";

const { values } = parseArgs({
  options: {
    key: { type: "string" },
    out: { type: "string" },
    base: { type: "string", default: "file:///usr/share/dashi/browser" },
    // A higher version than the one installed, so a browser takes a new build while developing (0.5.0.7).
    version: { type: "string" },
  },
});
if (!values.key || !values.out) {
  console.error("usage: dashi-browser-pack --key <private.pem> --out <dir> [--base <url of the out dir once installed>]");
  process.exit(2);
}

const source = resolve(import.meta.dir, "../browser-extension");
const read: unknown = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
// The whole manifest is written back; only its version and key are read.
const manifest = { ...(isRecord(read) ? read : {}), ...must(obj({ version: str(), key: str() }, { strict: false }), read, "manifest.json") };
if (values.version) {
  if (!/^\d+(\.\d+){0,3}$/.test(values.version)) throw new Error("dashi-browser-pack: --version is up to four numbers: 0.5.0.7");
  manifest.version = values.version;
}
const pem = readFileSync(values.key, "utf8");
const id = idFromManifestKey(manifest.key);
if (extensionId(publicDer(pem)) !== id) {
  console.error(`dashi-browser-pack: ${values.key} is not the key of the manifest's extension (${id})`);
  process.exit(1);
}

async function bundle(entry: string, format: "esm" | "iife"): Promise<Uint8Array> {
  const built = await Bun.build({ entrypoints: [join(source, entry)], target: "browser", format, minify: false });
  if (!built.success || !built.outputs[0]) {
    for (const log of built.logs) console.error(log);
    throw new Error(`dashi-browser-pack: ${entry} didn't build`);
  }
  return new Uint8Array(await built.outputs[0].arrayBuffer());
}

const files = [
  { path: "manifest.json", data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`) },
  { path: "background.js", data: await bundle("src/background/main.ts", "esm") },
  { path: "content.js", data: await bundle("src/content/main.ts", "iife") },
];
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "dashi-browser.crx"), crx3(zip(files), pem));
writeFileSync(join(out, "updates.xml"), updateManifest(id, manifest.version, `${values.base.replace(/\/$/, "")}/dashi-browser.crx`));
// The unpacked extension too, for --load-extension while developing.
mkdirSync(join(out, "unpacked"), { recursive: true });
for (const file of files) writeFileSync(join(out, "unpacked", file.path), file.data);
console.log(`${id} ${manifest.version} ${out}`);
