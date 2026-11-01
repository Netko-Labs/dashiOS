/**
 * One Calendar at a time, and a way to tell it to show a day. The running app
 * listens on `$XDG_RUNTIME_DIR/dashi-calendar.sock`; a second start, and the
 * shell (the notification center's month, a reminder's banner), send it one
 * JSON line, `{"day": "2026-11-05"}`, and it answers `{"ok": true}`. The
 * runtime directory is the person's own (mode 0700), and the line is parsed as
 * untrusted: only a real day is acted on.
 */

import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Day, isDay } from "./dates.ts";

export function socketPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(env.XDG_RUNTIME_DIR || tmpdir(), "dashi-calendar.sock");
}

export interface OpenMessage {
  day: Day;
}

export function parseMessage(line: string): OpenMessage | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { day } = value as Record<string, unknown>;
    return isDay(day) ? { day } : null;
  } catch {
    return null;
  }
}

/** The `--day 2026-11-05` a start was given, or null. */
export function dayFromArgs(argv: readonly string[] = Bun.argv.slice(2)): Day | null {
  const at = argv.indexOf("--day");
  const value = at >= 0 ? argv[at + 1] : undefined;
  return isDay(value) ? value : null;
}

/** Tells a running Calendar to show `day`. True when one answered; false when none is running. */
export async function openInRunning(day: Day, path: string = socketPath(), timeoutMs = 1500): Promise<boolean> {
  if (!existsSync(path)) return false;
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    Bun.connect({
      unix: path,
      socket: {
        open: (socket) => {
          socket.write(`${JSON.stringify({ day })}\n`);
        },
        data: (socket, data) => {
          finish(data.toString().includes('"ok":true'));
          socket.end();
        },
        close: () => finish(false),
        error: () => finish(false),
        connectError: () => finish(false),
      },
    }).catch(() => finish(false));
  });
}

/** Listens for open requests; returns the function that stops. A stale socket file from a crashed run is replaced. */
export function listenForOpen(onOpen: (day: Day) => void, path: string = socketPath()): () => void {
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
        if (text.length > 4096) return void socket.end();
        const lines = text.split("\n");
        buffers.set(socket, lines.pop() ?? "");
        for (const line of lines) {
          const message = parseMessage(line);
          if (message) onOpen(message.day);
          socket.write(`${JSON.stringify(message ? { ok: true } : { ok: false })}\n`);
        }
      },
    },
  });
  return () => {
    server.stop(true);
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  };
}
