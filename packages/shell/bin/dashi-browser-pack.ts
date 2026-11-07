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
import { crx3, extensionId, idFromManifestKey, publicDer, updateManifest, zip } from "../src/browser/crx.ts";

const { values } = parseArgs({
  options: { key: { type: "string" }, out: { type: "string" }, base: { type: "string", default: "file:///usr/share/dashi/browser" } },
});
if (!values.key || !values.out) {
  console.error("usage: dashi-browser-pack --key <private.pem> --out <dir> [--base <url of the out dir once installed>]");
  process.exit(2);
}

const source = resolve(import.meta.dir, "../browser-extension");
const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as { version: string; key: string };
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
  { path: "manifest.json", data: new Uint8Array(readFileSync(join(source, "manifest.json"))) },
  { path: "background.js", data: await bundle("src/background/index.ts", "esm") },
  { path: "content.js", data: await bundle("src/content/index.ts", "iife") },
];
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "dashi-browser.crx"), crx3(zip(files), pem));
writeFileSync(join(out, "updates.xml"), updateManifest(id, manifest.version, `${values.base.replace(/\/$/, "")}/dashi-browser.crx`));
// The unpacked extension too, for --load-extension while developing.
mkdirSync(join(out, "unpacked"), { recursive: true });
for (const file of files) writeFileSync(join(out, "unpacked", file.path), file.data);
console.log(`${id} ${manifest.version} ${out}`);
