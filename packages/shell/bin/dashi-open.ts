#!/usr/bin/env bun
/**
 * dashi-open: hands a `dashi://` link to the running Dashi session, which
 * opens it (packages/shell/src/actions/lib/links.ts). It is what the desktop
 * entry for `x-scheme-handler/dashi` runs, so `xdg-open` and `gio open`
 * reach here; from a terminal:
 *
 *   dashi-open dashi://settings/appearance/dark-mode
 *
 * Prints what the shell answered; exits 0 when it was opened, 1 otherwise.
 */

import { openLink } from "../src/shared/links/open-link.ts";

const url = process.argv[2];
if (!url || process.argv.length > 3) {
  console.error("usage: dashi-open dashi://…");
  process.exit(2);
}

const answer = await openLink(url);
if (answer.ok) {
  if (answer.text) console.log(answer.text);
  process.exit(0);
}
console.error(`dashi-open: ${answer.error}${answer.error.startsWith("Dashi can't be reached") ? " Is a Dashi session running?" : ""}`);
process.exit(1);
