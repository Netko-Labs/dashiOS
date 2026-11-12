import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLink } from "../src/shared/links/open-link.ts";

test("an answer that arrives cut in the middle of a character reads whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-links-"));
  const path = join(dir, "links.sock");
  const line = new TextEncoder().encode(`${JSON.stringify({ ok: true, text: "Opened “Café”" })}\n`);
  // Cut inside the é (two bytes) and inside a curly quote (three).
  const cuts = [line.indexOf(0xc3) + 1, line.lastIndexOf(0x80) + 1];
  const server = Bun.listen({
    unix: path,
    socket: {
      data(socket) {
        socket.write(line.subarray(0, cuts[0]));
        socket.flush();
        setImmediate(() => {
          socket.write(line.subarray(cuts[0], cuts[1]));
          socket.flush();
          setImmediate(() => {
            socket.write(line.subarray(cuts[1]));
            socket.end();
          });
        });
      },
    },
  });
  try {
    expect(await openLink("dashi://settings", path)).toEqual({ ok: true, text: "Opened “Café”" });
  } finally {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
