#!/usr/bin/env bun
/**
 * dashi-open: hands a `dashi://` link to the running Dashi session, which
 * opens it (packages/shell/src/actions/links.ts). It is what the desktop
 * entry for `x-scheme-handler/dashi` runs, so `xdg-open` and `gio open`
 * reach here; from a terminal:
 *
 *   dashi-open dashi://settings/appearance/dark-mode
 *
 * Prints what the shell answered; exits 0 when it was opened, 1 otherwise.
 */

import { join } from "node:path";

const url = process.argv[2];
if (!url || process.argv.length > 3) {
  console.error("usage: dashi-open dashi://…");
  process.exit(2);
}

const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const path = process.env.DASHI_LINKS_SOCKET || join(runtime, "dashi-links.sock");

let answer = "";
const done = Promise.withResolvers<void>();
try {
  const socket = await Bun.connect({
    unix: path,
    socket: {
      data(_socket, data) {
        answer += new TextDecoder().decode(data);
      },
      close() {
        done.resolve();
      },
      error() {
        done.resolve();
      },
    },
  });
  socket.write(`${JSON.stringify({ open: url })}\n`);
} catch (error) {
  console.error(`dashi-open: can't reach Dashi at ${path} (${error}); is a Dashi session running?`);
  process.exit(1);
}
await done.promise;

let reply: unknown = null;
try {
  reply = JSON.parse(answer.split("\n")[0] ?? "");
} catch {
  // Below: no answer.
}
const fields = typeof reply === "object" && reply !== null ? (reply as Record<string, unknown>) : {};
if (fields.ok === true) {
  if (typeof fields.text === "string") console.log(fields.text);
  process.exit(0);
}
console.error(`dashi-open: ${typeof fields.error === "string" ? fields.error : "Dashi gave no answer."}`);
process.exit(1);
