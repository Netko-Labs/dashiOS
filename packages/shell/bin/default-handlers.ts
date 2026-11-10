#!/usr/bin/env bun
/**
 * default-handlers: what the installer writes into the system mimeapps.list.
 *
 *   bun default-handlers.ts <mimeapps.list>             the file with Dashi's defaults merged in, on stdout
 *   bun default-handlers.ts --remove <mimeapps.list>    the file without them, on stdout
 *
 * It only prints; the installer puts the result in place (with sudo when it
 * must). A missing file counts as empty. See src/default-handlers.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { defaultHandlers, mergeDefaults, removeDefaults } from "../src/default-handlers.ts";
import { FIRST_PARTY } from "../src/shared/apps/index.ts";

const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const path = remove ? args[1] : args[0];
if (!path || args.length > (remove ? 2 : 1)) {
  console.error("usage: default-handlers.ts [--remove] <mimeapps.list>");
  process.exit(2);
}
const text = existsSync(path) ? readFileSync(path, "utf8") : "";
const wanted = defaultHandlers(FIRST_PARTY);
process.stdout.write(remove ? removeDefaults(text, Object.values(wanted)) : mergeDefaults(text, wanted));
