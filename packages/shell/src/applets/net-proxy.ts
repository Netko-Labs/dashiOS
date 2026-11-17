/**
 * The network an extension that says `network:HOST` gets (store-v2 spec § 5,
 * docs/launcher-extensions.md "Permissions"): its sandbox has no network of
 * its own (bubblewrap's own network namespace: only loopback), and one Unix
 * socket to this proxy, which runs outside the sandbox in the extension's
 * unit (bin/dashi-applet-run.ts). The proxy speaks HTTP's CONNECT and lets
 * through only HTTPS (port 443) to the hosts the manifest names; every other
 * request is answered 403 and closed. Inside, a bridge (bin/dashi-net-bridge.ts)
 * listens on loopback for Bun's `fetch` (HTTPS_PROXY) and passes each
 * connection to this socket.
 *
 * TLS stays the extension's, end to end: the proxy sees the host it asked
 * for and the bytes' count, never what they say. It resolves names itself,
 * so a host is held to its name, not to whatever the sandbox's resolver says.
 */

import { unlinkSync } from "node:fs";
import type { Socket } from "bun";

/** The one port it lets through: HTTPS. */
export const PROXY_PORT_ALLOWED = 443;
/** The most a request's head may be before it is refused. */
const MAX_HEAD = 8 * 1024;

/** Where a CONNECT may go (its host and port), or why it is refused (a status and the words). */
export function connectVerdict(head: string, hosts: readonly string[]): { status: number; why: string } | { host: string; port: number } {
  const line = head.split("\r\n", 1)[0] ?? "";
  const match = /^CONNECT ([^\s:]+|\[[^\]]+\]):(\d{1,5}) HTTP\/1\.[01]$/.exec(line);
  if (!match) return { status: 405, why: "only CONNECT, to HTTPS" };
  const host = (match[1] ?? "").toLowerCase().replace(/\.$/, "");
  const port = Number(match[2]);
  if (port !== PROXY_PORT_ALLOWED) return { status: 403, why: `only port ${PROXY_PORT_ALLOWED}` };
  if (!hosts.some((each) => each.toLowerCase() === host)) return { status: 403, why: `${host} is not an address this extension may reach` };
  return { host, port };
}

/** What the proxy dials: the real network, or a stand-in in tests. */
export type Dial = (host: string, port: number) => Promise<Socket<Link>>;

export interface Link {
  /** The other end of the pair, once it is open. */
  peer: Socket<Link> | null;
  /** The request's head, until it is whole. */
  head: string;
  /** Bytes for the peer that came before it opened. */
  pending: Uint8Array[];
}

/** Dials the host it was asked for; `route` sends it elsewhere (a stand-in upstream in tests). */
export function dialer(route: (host: string, port: number) => { hostname: string; port: number } = (hostname, port) => ({ hostname, port })): Dial {
  return (host, port) =>
    Bun.connect<Link>({
      ...route(host, port),
      data: { peer: null, head: "", pending: [] },
      socket: {
        data: (socket, chunk) => void socket.data.peer?.write(chunk),
        close: (socket) => void socket.data.peer?.end(),
        error: (socket) => void socket.data.peer?.end(),
      },
    });
}

export interface NetProxy {
  stop(): void;
}

function answer(socket: Socket<Link>, status: number, why: string): void {
  const body = `dashi: ${why}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${status === 405 ? "Method Not Allowed" : "Forbidden"}\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
  );
  socket.end();
}

async function open(client: Socket<Link>, head: string, rest: Uint8Array, hosts: readonly string[], dial: Dial, log: (line: string) => void): Promise<void> {
  const verdict = connectVerdict(head, hosts);
  if ("status" in verdict) {
    log(`refused: ${head.split("\r\n", 1)[0]} (${verdict.why})`);
    return answer(client, verdict.status, verdict.why);
  }
  try {
    const upstream = await dial(verdict.host, verdict.port);
    upstream.data.peer = client;
    client.data.peer = upstream;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (rest.length > 0) upstream.write(rest);
    for (const chunk of client.data.pending) upstream.write(chunk);
    client.data.pending = [];
  } catch {
    answer(client, 502, `couldn't reach ${verdict.host}`);
  }
}

/** Listens on `socket` (a path) and lets through CONNECTs to `hosts` only. */
export function startNetProxy(options: { socket: string; hosts: readonly string[]; dial?: Dial; log?: (line: string) => void }): NetProxy {
  const dial = options.dial ?? dialer();
  const log = options.log ?? ((line: string) => console.error(`dashi-net-proxy: ${line}`));
  try {
    unlinkSync(options.socket);
  } catch {}
  const server = Bun.listen<Link>({
    unix: options.socket,
    data: { peer: null, head: "", pending: [] },
    socket: {
      open: (socket) => {
        socket.data = { peer: null, head: "", pending: [] };
      },
      data: (socket, chunk) => {
        const link = socket.data;
        if (link.peer) return void link.peer.write(chunk);
        // The head is whole and the host is being dialled: what comes meanwhile waits.
        if (link.head.endsWith("\r\n\r\n")) return void link.pending.push(chunk);
        const text = link.head + new TextDecoder("latin1").decode(chunk);
        const end = text.indexOf("\r\n\r\n");
        if (end < 0) {
          if (text.length > MAX_HEAD) return answer(socket, 403, "the request's head is too long");
          link.head = text;
          return;
        }
        link.head = text.slice(0, end + 4);
        const rest = chunk.subarray(Math.max(0, chunk.length - (text.length - end - 4)));
        void open(socket, link.head, rest, options.hosts, dial, log);
      },
      close: (socket) => void socket.data.peer?.end(),
      error: (socket) => void socket.data.peer?.end(),
    },
  });
  return { stop: () => server.stop(true) };
}
