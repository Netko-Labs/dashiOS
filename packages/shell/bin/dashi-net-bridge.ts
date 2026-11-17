/**
 * dashi-net-bridge MAIN: inside an extension's sandbox that has no network
 * (`network:HOST`, src/applets/net-proxy.ts), before the extension runs.
 * It listens on loopback (127.0.0.1:3128, the sandbox's own: nothing else is
 * there) and passes each connection to the proxy's socket outside, which
 * lets through only HTTPS to the extension's hosts. The sandbox sets
 * HTTPS_PROXY to it, so Bun's `fetch` goes this way by itself; then the
 * extension's own main.js is imported, in this same process.
 *
 * Nothing here decides: refusing is the proxy's, outside. An extension that
 * dials around the bridge finds no network at all.
 */

/** Where the proxy's socket is inside the sandbox, and where the bridge listens. */
const SOCKET = "/run/applet/net/proxy.sock";
const PORT = 3128;

import type { Socket } from "bun";

interface Pair {
  peer: Socket<Pair> | null;
  pending: Uint8Array[];
}

const bridge = Bun.listen<Pair>({
  hostname: "127.0.0.1",
  port: PORT,
  data: { peer: null, pending: [] },
  socket: {
    open: (inside) => {
      inside.data = { peer: null, pending: [] };
      Bun.connect<Pair>({
        unix: SOCKET,
        data: { peer: inside, pending: [] },
        socket: {
          open: (outside) => {
            inside.data.peer = outside;
            for (const chunk of inside.data.pending) outside.write(chunk);
            inside.data.pending = [];
          },
          data: (outside, chunk) => void outside.data.peer?.write(chunk),
          close: (outside) => void outside.data.peer?.end(),
          error: (outside) => void outside.data.peer?.end(),
        },
      }).catch(() => void inside.end());
    },
    data: (inside, chunk) => {
      if (inside.data.peer) void inside.data.peer.write(chunk);
      else inside.data.pending.push(chunk);
    },
    close: (inside) => void inside.data.peer?.end(),
    error: (inside) => void inside.data.peer?.end(),
  },
});

// It never keeps the extension alive by itself: one whose work is done ends as it would without it.
bridge.unref();

const main = Bun.argv[2];
if (!main) {
  console.error("dashi-net-bridge: give the extension's main.js");
  process.exit(2);
}
// The extension sees its arguments as it would without the bridge: bun, main.js, then its own.
process.argv.splice(1, 1);
await import(main);
