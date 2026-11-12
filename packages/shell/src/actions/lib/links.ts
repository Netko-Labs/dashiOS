/**
 * `dashi://` links from outside: `xdg-open dashi://…`, a link in a note or
 * a help page, a script. The desktop entry for `x-scheme-handler/dashi`
 * (entry.ts) runs bin/dashi-open.ts, which hands the link to the shell on
 * `$XDG_RUNTIME_DIR/dashi-links.sock` and prints the answer:
 *
 *   client → shell  {"open":"dashi://settings/appearance/dark-mode"}
 *   shell → client  {"ok":true,"text":"Dark Mode is open in System Settings."}
 *                   {"ok":false,"error":"Nothing is at dashi://…"}
 *
 * One request per connection; the shell closes it after answering. The
 * socket is this user's (0600, and SO_PEERCRED says who connected), but what
 * arrives is still a link from anywhere: it is run as a link (run.ts), so a
 * destructive action is opened, never run.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "@dashi/shape";
import { peerPid, socketFd } from "../../agents/peer.ts";
import { LINKS_SOCKET } from "../../shared/links/index.ts";
import { MAX_ADDRESS } from "../address.ts";
import type { Outcome } from "../types.ts";

/** Bytes in the one request line; more ends the connection. */
const MAX_LINE = MAX_ADDRESS + 64;
/** Links being answered at once. */
const MAX_CONNECTIONS = 16;

export function linksSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  return env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, LINKS_SOCKET) : null;
}

/** The request line, checked: the link to open, or why it was refused. */
export function parseLinkRequest(line: string): { url: string } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { error: "The request is not JSON." };
  }
  if (!isRecord(value)) return { error: "The request must be an object." };
  const keys = Object.keys(value);
  const url = value.open;
  if (keys.length !== 1 || typeof url !== "string") return { error: 'The request is {"open": "dashi://…"}.' };
  if (url.length > MAX_ADDRESS) return { error: "The link is too long." };
  return { url };
}

/** The answer line for an outcome. */
export const replyLine = (outcome: Outcome): string =>
  `${JSON.stringify(outcome.ok ? { ok: true, text: outcome.text } : { ok: false, error: outcome.error })}\n`;

export interface LinkServerOptions {
  path: string | null;
  /** Open a link that came from outside. */
  open(url: string): Promise<Outcome>;
  /** The connecting process, null when it can't be told or isn't this user's. */
  peer?: (fd: number) => number | null;
}

interface LinkState {
  buffer: string;
  answered: boolean;
}

/** Listens on `path`; returns what stops it (and removes the socket). */
export function serveLinks({ path, open, peer = peerPid }: LinkServerOptions): () => void {
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; dashi:// links can't reach the shell");
    return () => {};
  }
  if (existsSync(path)) unlinkSync(path);
  let connections = 0;
  const server = Bun.listen<LinkState>({
    unix: path,
    socket: {
      open(socket) {
        const fd = socketFd(socket);
        if ((fd !== null ? peer(fd) : null) === null || connections >= MAX_CONNECTIONS) {
          socket.terminate();
          return;
        }
        connections++;
        socket.data = { buffer: "", answered: false };
      },
      data(socket, data) {
        const state = socket.data;
        if (!state || state.answered) return;
        state.buffer += new TextDecoder().decode(data);
        const newline = state.buffer.indexOf("\n");
        if (newline < 0) {
          if (state.buffer.length > MAX_LINE) socket.terminate();
          return;
        }
        state.answered = true;
        const request = parseLinkRequest(state.buffer.slice(0, newline));
        const answer = "error" in request ? Promise.resolve<Outcome>({ ok: false, error: request.error }) : open(request.url);
        void answer
          .catch((error): Outcome => ({ ok: false, error: error instanceof Error ? error.message : String(error) }))
          .then((outcome) => {
            socket.write(replyLine(outcome));
            socket.end();
          });
      },
      close(socket) {
        // Only the ones let in were counted.
        if (socket.data) connections = Math.max(0, connections - 1);
      },
      error() {},
    },
  });
  chmodSync(path, 0o600);
  return () => {
    server.stop(true);
    if (existsSync(path)) unlinkSync(path);
  };
}
