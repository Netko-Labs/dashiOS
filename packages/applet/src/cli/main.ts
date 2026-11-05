#!/usr/bin/env bun
/**
 * dashi-applet: making an applet (docs/applets.md, "The dev loop").
 *
 *   dashi-applet new NAME          an applet in ./NAME: applet.json, src/main.tsx, ready to run
 *   dashi-applet dev [--vm]        run it with a "dev" badge, the message log, reload on save
 *   dashi-applet pack [--sign KEY] build NAME-VERSION.dashi-applet in dist/ (and sign it with an unencrypted key)
 *   dashi-applet publish [--catalog DIR] [--sign KEY]
 *                                  prepare the pull request to the catalog in a local checkout; never pushes
 *   dashi-applet keygen            a throwaway key pair for trying things (real keys: minisign -G)
 *   dashi-applet install FILE      install a package on this machine, unsigned, for testing
 *   dashi-applet check             validate applet.json
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { appletsRoot, installFiles } from "../installed.ts";
import { readManifest } from "../manifest.ts";
import { sha256, unpack } from "../package.ts";
import { generateKeys } from "../signing/minisign.ts";
import { dev } from "./dev.ts";
import { packTo, publish } from "./publish.ts";
import { templateFiles } from "./templates.ts";

const USAGE = "dashi-applet new NAME | dev [--vm] | pack [--sign KEY] | publish [--catalog DIR] [--sign KEY] | keygen | install FILE | check";

function create(name: string | undefined): number {
  if (!name || !/^[a-z][a-z0-9-]{0,40}$/.test(name)) {
    console.error("dashi-applet new: give a name in lowercase letters, digits and dashes, such as weather");
    return 1;
  }
  const dir = resolve(name);
  if (existsSync(dir)) {
    console.error(`dashi-applet new: ${dir} is there already`);
    return 1;
  }
  for (const [path, text] of Object.entries(templateFiles(name))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  console.log(`  created ${name}/ (applet.json, src/main.tsx)`);
  console.log(`  cd ${name} && bun install && bun run dev`);
  return 0;
}

function check(dir: string): number {
  const path = join(dir, "applet.json");
  if (!existsSync(path)) {
    console.error("dashi-applet check: no applet.json here");
    return 1;
  }
  const manifest = readManifest(readFileSync(path, "utf8"));
  if ("error" in manifest) {
    console.error(`applet.json: ${manifest.error}`);
    return 1;
  }
  console.log(`  ✓ ${manifest.id} ${manifest.version}`);
  return 0;
}

function keygen(dir: string): number {
  const keys = generateKeys();
  const secretDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "dashi-applet");
  mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const secret = join(secretDir, `${keys.keyId}.key`);
  writeFileSync(secret, keys.secretKey, { mode: 0o600 });
  chmodSync(secret, 0o600);
  writeFileSync(join(dir, "author.pub"), keys.publicKey);
  console.log(`  ✓ author.pub here; the secret key in ${secret} (unencrypted: for trying things only)`);
  console.log("  For a key you publish with, use `minisign -G -p author.pub -s ~/.minisign/applet.key` and keep it safe: updates must be signed by it.");
  return 0;
}

function install(file: string | undefined): number {
  if (!file || !existsSync(file)) {
    console.error("dashi-applet install: give a .dashi-applet file");
    return 1;
  }
  const bytes = new Uint8Array(readFileSync(file));
  const unpacked = unpack(bytes);
  if ("error" in unpacked) {
    console.error(`dashi-applet install: ${unpacked.error}`);
    return 1;
  }
  // No consent here: the shell asks on the screen before it runs.
  const dir = installFiles(appletsRoot(), unpacked, {
    version: unpacked.manifest.version,
    sha256: sha256(bytes),
    authorKey: null,
    source: "local",
    consent: [],
  });
  console.log(`  ✓ ${unpacked.manifest.id} ${unpacked.manifest.version} in ${dir}; Dashi asks before it runs`);
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...args] = argv;
  const here = process.cwd();
  try {
    switch (command) {
      case "new":
        return create(args[0]);
      case "dev":
        return await dev(here, args);
      case "pack": {
        const at = args.indexOf("--sign");
        const { packed, path, signature } = await packTo(here, at >= 0 ? args[at + 1] : undefined);
        console.log(`  ✓ ${path} (${Math.round(packed.bytes.byteLength / 1024)} KB, sha256 ${packed.sha256})${signature ? ", signed" : ""}`);
        return 0;
      }
      case "publish":
        return await publish(here, args);
      case "keygen":
        return keygen(here);
      case "install":
        return install(args[0]);
      case "check":
        return check(here);
      default:
        console.error(USAGE);
        return command === undefined || command === "help" || command === "--help" ? 0 : 2;
    }
  } catch (error) {
    console.error(`dashi-applet ${command}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
