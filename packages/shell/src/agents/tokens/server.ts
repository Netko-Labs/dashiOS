/**
 * Where `dashi-agent` asks for a sandbox's token proxy (docs/secrets.md,
 * "Tokens that stay home"): `$XDG_RUNTIME_DIR/dashi-tokens.sock`, the
 * person's (0600), which no sandbox reaches (its runtime directory is its
 * own). Before it starts the agent's scope, dashi-agent sends one line and
 * keeps the connection open while the agent runs:
 *
 *   dashi-agent → shell  {"open":"dashi-agent-claude-7.scope"}
 *   shell → dashi-agent  {"ok":true,"socket":"…/proxy.sock","ca":"…/ca.pem","bundle":"…/bundle.pem","key":"…"}
 *
 * The shell makes a CA for that sandbox alone, writes its certificate (and
 * the system's CAs with it), and listens for the sandbox's CONNECTs. When
 * the connection closes, the agent is done: the proxy stops, the CA's key
 * is dropped, and the files go.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { logActivity } from "../consent.ts";
import { peerPid, socketFd } from "../peer.ts";
import { inAgentScope } from "../sandbox.ts";
import { SandboxProxy, type TokenSource } from "./lib/proxy.ts";
import { makeAuthority } from "./lib/x509.ts";

export const TOKENS_SOCKET = "dashi-tokens.sock";
const MAX_LINE = 512;
const MAX_SANDBOXES = 64;

/** Where each system keeps its CA bundle (Fedora's first). */
export const SYSTEM_BUNDLES = ["/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem"];

/** What dashi-agent gets back: the proxy's socket, the CA alone and with the system's, and the credentials. */
export interface ProxyGrant {
  socket: string;
  ca: string;
  bundle: string;
  key: string;
}

const UNIT = /^dashi-agent-[A-Za-z0-9_-]{1,40}-\d{1,10}\.scope$/;

/** The request line, checked: the sandbox's scope, or why not. */
export function parseOpen(line: string): { unit: string } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { error: "The request is not JSON." };
  }
  if (!isRecord(value)) return { error: "The request must be an object." };
  const { open, ...rest } = value;
  if (Object.keys(rest).length > 0 || typeof open !== "string" || !UNIT.test(open))
    return { error: 'The request is {"open": "dashi-agent-<name>-<n>.scope"}.' };
  return { unit: open };
}

export function tokensSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  return env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, TOKENS_SOCKET) : null;
}

function readCgroup(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, "utf8");
  } catch {
    return "";
  }
}

/** The system's CAs, then the sandbox's: what TLS clients in the sandbox trust. */
function systemBundle(): string {
  for (const path of SYSTEM_BUNDLES) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // The next one.
    }
  }
  return "";
}

const randomKey = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");

/** Make one sandbox's proxy in `dir`; what to tell dashi-agent, and what stops it. */
export async function openSandbox(unit: string, dir: string, tokens: TokenSource): Promise<{ grant: ProxyGrant; close: () => void }> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ca = await makeAuthority(unit);
  const grant: ProxyGrant = { socket: join(dir, "proxy.sock"), ca: join(dir, "ca.pem"), bundle: join(dir, "bundle.pem"), key: randomKey() };
  writeFileSync(grant.ca, ca.cert, { mode: 0o644 });
  const system = systemBundle();
  writeFileSync(grant.bundle, `${system}${system.endsWith("\n") || system === "" ? "" : "\n"}${ca.cert}`, { mode: 0o644 });
  const proxy = new SandboxProxy({
    unit,
    dir,
    key: grant.key,
    ca,
    tokens,
    used: (name, host) => logActivity({ agent: unit, claims: null, tool: "token", outcome: `${name} sent to ${host}` }),
  });
  await proxy.listen(grant.socket);
  chmodSync(grant.socket, 0o600);
  return {
    grant,
    close: () => {
      proxy.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

interface Connection {
  buffer: string;
  close: (() => void) | null;
  done: boolean;
}

export interface TokenServerOptions {
  path: string | null;
  tokens: TokenSource;
  /** The connecting process, null when it can't be told or isn't this user's. */
  peer?: (fd: number) => number | null;
  cgroup?: (pid: number) => string;
}

/** Listens on `path`; returns what stops it (every sandbox's proxy with it). */
export function serveTokens({ path, tokens, peer = peerPid, cgroup = readCgroup }: TokenServerOptions): () => void {
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; agents' tokens can't be swapped in");
    return () => {};
  }
  if (existsSync(path)) unlinkSync(path);
  const root = join(dirname(path), "dashi-tokens");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const open = new Set<Connection>();
  const server = Bun.listen<Connection>({
    unix: path,
    socket: {
      open(socket) {
        const fd = socketFd(socket);
        const pid = fd !== null ? peer(fd) : null;
        // The person's own dashi-agent only: never one started from inside a sandbox.
        if (pid === null || inAgentScope(cgroup(pid)) || open.size >= MAX_SANDBOXES) {
          socket.terminate();
          return;
        }
        socket.data = { buffer: "", close: null, done: false };
        open.add(socket.data);
      },
      data(socket, data) {
        const state = socket.data;
        if (!state || state.done) return;
        state.buffer += new TextDecoder().decode(data);
        const newline = state.buffer.indexOf("\n");
        if (newline < 0) {
          if (state.buffer.length > MAX_LINE) socket.terminate();
          return;
        }
        state.done = true;
        const request = parseOpen(state.buffer.slice(0, newline));
        if ("error" in request) {
          socket.end(`${JSON.stringify({ ok: false, error: request.error })}\n`);
          return;
        }
        const dir = join(root, randomKey().slice(0, 10));
        void openSandbox(request.unit, dir, tokens)
          .then(({ grant, close }) => {
            // The agent ended while the CA was made.
            if (!open.has(state)) return close();
            state.close = close;
            socket.write(`${JSON.stringify({ ok: true, ...grant })}\n`);
          })
          .catch((error: unknown) => {
            console.error("dashi-shell: token proxy:", error instanceof Error ? error.message : error);
            rmSync(dir, { recursive: true, force: true });
            socket.end(`${JSON.stringify({ ok: false, error: "The token proxy couldn't start." })}\n`);
          });
      },
      close(socket) {
        const state = socket.data;
        if (!state) return;
        open.delete(state);
        state.close?.();
      },
      error() {},
    },
  });
  chmodSync(path, 0o600);
  return () => {
    server.stop(true);
    for (const state of open) state.close?.();
    open.clear();
    if (existsSync(path)) unlinkSync(path);
    rmSync(root, { recursive: true, force: true });
  };
}
