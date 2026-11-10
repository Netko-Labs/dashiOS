/**
 * Dashi's extension's service worker. It talks to one thing: Dashi's native
 * host (dashi-browser-host, `dev.dashi.browser`), which relays the shell's
 * requests over the shell's socket; no page or other extension can send it a
 * command. It answers each request once, from the tabs and the content
 * script in their frames, and keeps each tab's element numbers (RefTable).
 */

import { connectHost } from "./host.ts";
import { METHODS } from "./methods.ts";

connectHost(async (method, params) => {
  const run = METHODS[method];
  if (!run) throw new Error(`Unknown request ${method}.`);
  return run(params);
});
