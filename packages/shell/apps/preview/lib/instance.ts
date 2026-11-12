/**
 * An empty Preview window takes the next file opened: while it shows
 * nothing it listens on `$XDG_RUNTIME_DIR/dashi-preview/<pid>.sock`, and a
 * start given a file first offers it there, one JSON line
 * `{"open": "/abs/path"}`, answered `{"ok": true}` when the window took it
 * (it then leaves, as Calendar's second start does). Each file still opens
 * in a window of its own when no empty one is waiting. The folder is the
 * person's (the runtime directory, mode 0700) and a line is parsed as
 * untrusted: only an absolute path is acted on, and the window checks it as
 * it checks any file it opens.
 */

import { chmodSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isRecord } from "@dashi/shape";

/** Bytes one connection may send. */
const MAX_LINE = 8192;

export function handoffDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(env.XDG_RUNTIME_DIR || tmpdir(), "dashi-preview");
}

/** A line as a file to open, or null. */
export function parseHandoff(line: string): string | null {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) return null;
    const { open } = value;
    return typeof open === "string" && open.startsWith("/") && !open.includes("\0") && open.length < 4096 ? open : null;
  } catch {
    return null;
  }
}

/** Offers `path` to one empty window after another; true once one took it, false when none is waiting. */
export async function handToEmpty(path: string, dir: string = handoffDir(), timeoutMs = 1500): Promise<boolean> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => /^\d+\.sock$/.test(name));
  } catch {
    return false;
  }
  for (const name of names) {
    if (await offer(join(dir, name), path, timeoutMs)) return true;
  }
  return false;
}

function offer(socketPath: string, path: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    let answer = "";
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Bun.connect({
      unix: socketPath,
      socket: {
        open: (socket) => void socket.write(`${JSON.stringify({ open: path })}\n`),
        data: (socket, data) => {
          answer += data.toString();
          if (!answer.includes("\n")) return;
          finish(parseAnswer(answer));
          socket.end();
        },
        close: () => finish(false),
        error: () => finish(false),
        connectError: () => {
          // No one listens: a window that went without tidying up.
          try {
            unlinkSync(socketPath);
          } catch {
            // Already gone.
          }
          finish(false);
        },
      },
    }).catch(() => finish(false));
  });
}

function parseAnswer(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text.split("\n")[0] ?? "");
    return isRecord(value) && value.ok === true;
  } catch {
    return false;
  }
}

/**
 * Listen for a file to open; `take` says whether this window took it (it
 * may have opened one of its own meanwhile). Returns the way to stop, which
 * removes the socket.
 */
export function listenWhileEmpty(take: (path: string) => boolean, dir: string = handoffDir()): () => void {
  const path = join(dir, `${process.pid}.sock`);
  let stop = (): void => {};
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      unlinkSync(path);
    } catch {
      // Nothing left over.
    }
    const buffers = new WeakMap<object, string>();
    const server = Bun.listen({
      unix: path,
      socket: {
        data(socket, data) {
          const text = (buffers.get(socket) ?? "") + data.toString();
          if (text.length > MAX_LINE) return void socket.end();
          const lines = text.split("\n");
          buffers.set(socket, lines.pop() ?? "");
          for (const line of lines) {
            const file = parseHandoff(line);
            socket.write(`${JSON.stringify({ ok: file !== null && take(file) })}\n`);
          }
          // One offer per connection: answered, it's done.
          if (lines.length > 0) socket.end();
        },
      },
    });
    chmodSync(path, 0o600);
    stop = () => {
      // Not `stop(true)`: a reply still on its way finishes first.
      server.stop();
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    };
  } catch {
    // Can't listen: a file opened elsewhere gets a window of its own, as before.
  }
  return () => stop();
}
