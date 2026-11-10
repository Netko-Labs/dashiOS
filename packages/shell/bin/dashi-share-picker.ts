#!/usr/bin/env bun

/**
 * dashi-share-picker: xdg-desktop-portal-wlr's `chooser_cmd` (chooser_type
 * simple; session/xdg-desktop-portal-wlr.conf). It asks the running shell
 * to show Dashi's picker ($XDG_RUNTIME_DIR/dashi-share.sock, the shell's
 * src/share-picker/) and prints what the person chose, as the wlr portal
 * reads it: `Monitor: <output>` or `Window: <toplevel identifier>`. Nothing
 * printed means declined (the portal's rule), so a missing shell or a bad
 * answer declines too; the exit status is 1 then, never 127 (the portal's
 * "no such command").
 */

import { MAX_LINE, parseAnswer, socketPath } from "../src/share-picker/protocol.ts";
import { LineBuffer } from "../src/shared/io/index.ts";

const path = socketPath();
if (!path) {
  console.error("dashi-share-picker: no XDG_RUNTIME_DIR");
  process.exit(1);
}

const answer = await new Promise<string | null>((resolve) => {
  const lines = new LineBuffer();
  Bun.connect({
    unix: path,
    socket: {
      open(socket) {
        socket.write(`${JSON.stringify({ pick: {} })}\n`);
      },
      data(socket, chunk) {
        const [line] = lines.push(chunk);
        if (line !== undefined) {
          resolve(parseAnswer(line));
          socket.end();
        } else if (lines.pending > MAX_LINE) {
          resolve(null);
          socket.end();
        }
      },
      close() {
        resolve(null);
      },
      connectError() {
        resolve(null);
      },
    },
  }).catch(() => resolve(null));
});

if (answer === null) process.exit(1);
await Bun.write(Bun.stdout, `${answer}\n`);
process.exit(0);
