/**
 * dashi-agent's half of the token proxy (docs/secrets.md, "Tokens that stay
 * home"): ask the shell for a sandbox's proxy before the scope starts (and
 * hold the connection while the agent runs), then, inside the scope but
 * outside bubblewrap, relay a loopback port to the proxy's socket for
 * HTTPS_PROXY, which most programs take only as host:port.
 */

import net from "node:net";
import { isRecord } from "@dashi/shape";
import { LineBuffer } from "../../shared/io/lines.ts";
import type { ProxyGrant } from "./server.ts";

const ANSWER_MS = 10_000;

function parseGrant(value: unknown): ProxyGrant | null {
  if (!isRecord(value)) return null;
  const { ok, socket, ca, bundle, key } = value;
  if (ok !== true || typeof socket !== "string" || typeof ca !== "string" || typeof bundle !== "string" || typeof key !== "string") return null;
  return { socket, ca, bundle, key };
}

/** The shell's proxy for `unit`, held open until `close`; null (and why) when there is none. */
export function requestProxy(path: string, unit: string): Promise<{ grant: ProxyGrant; close: () => void } | { error: string }> {
  return new Promise((resolve) => {
    const lines = new LineBuffer();
    let settled = false;
    const socket = net.connect(path);
    const finish = (value: { grant: ProxyGrant; close: () => void } | { error: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ("error" in value) socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ error: "the shell didn't answer" }), ANSWER_MS);
    socket.on("connect", () => socket.write(`${JSON.stringify({ open: unit })}\n`));
    socket.on("data", (chunk: Buffer | string) => {
      for (const line of lines.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))) {
        let reply: unknown;
        try {
          reply = JSON.parse(line);
        } catch {
          reply = null;
        }
        const grant = parseGrant(reply);
        if (grant) finish({ grant, close: () => socket.destroy() });
        else {
          const error = isRecord(reply) ? reply.error : undefined;
          finish({ error: typeof error === "string" ? error : "the shell refused" });
        }
        return;
      }
    });
    socket.on("error", (error) => finish({ error: error.message }));
    socket.on("close", () => finish({ error: "the shell closed the connection" }));
  });
}

/** Relay 127.0.0.1:<port> to the proxy's socket; the port, and what stops it. */
export function relay(socketPath: string): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((client) => {
    const proxy = net.connect(socketPath);
    client.pipe(proxy);
    proxy.pipe(client);
    client.on("error", () => proxy.destroy());
    proxy.on("error", () => client.destroy());
    client.on("close", () => proxy.destroy());
    proxy.on("close", () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) return reject(new Error("no port"));
      resolve({ port: address.port, close: () => server.close() });
    });
  });
}
