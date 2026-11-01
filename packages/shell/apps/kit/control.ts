/**
 * A development handle on a running app, for checks and agents that must not
 * send desktop input: with `DASHI_APP_CONTROL=<socket path>` the app listens
 * there for newline-delimited JSON and drives its own window through Metal's
 * simulation channel (input delivered inside the renderer, as real input).
 * Off unless the variable is set; put the socket under `$XDG_RUNTIME_DIR`.
 *
 *   {"click": "<testID>"}       a click on that node
 *   {"contextmenu": "<testID>"} a right-click on that node
 *   {"key": "ctrl-a"}           a keystroke (GPUI's spelling: "enter", "backspace", "5")
 *   {"type": "12+3"}            typed text
 *   {"sim": <SimCommand>}       any other simulation command
 *   {"tree": true}              answers {"tree": <the last tree sent>}
 *
 * Each line is answered with {"ok": true} or {"error": "..."}.
 */

import { unlinkSync } from "node:fs";
import type { NativeHostTransport, NativeRoot, SimCommand } from "@mirinjs/metal";

export type ControlRequest =
  | { click: string }
  | { contextmenu: string }
  | { key: string }
  | { type: string }
  | { sim: SimCommand }
  | { tree: true };

/** One line as a request, or null when it is not one. */
export function parseControl(line: string): ControlRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.click === "string") return { click: record.click };
  if (typeof record.contextmenu === "string") return { contextmenu: record.contextmenu };
  if (typeof record.key === "string") return { key: record.key };
  if (typeof record.type === "string") return { type: record.type };
  if (record.tree === true) return { tree: true };
  if (typeof record.sim === "object" && record.sim !== null && typeof (record.sim as Record<string, unknown>).kind === "string") {
    return { sim: record.sim as SimCommand };
  }
  return null;
}

/** Carries out one request; the reply to write back. */
export function handleControl(request: ControlRequest, host: Pick<NativeHostTransport, "simulate">, root: Pick<NativeRoot, "nodeId" | "lastTree">): Record<string, unknown> {
  if ("click" in request) {
    const id = root.nodeId(request.click);
    if (!id) return { error: `no node with testID ${request.click}` };
    host.simulate({ kind: "click", id });
  } else if ("contextmenu" in request) {
    const id = root.nodeId(request.contextmenu);
    if (!id) return { error: `no node with testID ${request.contextmenu}` };
    host.simulate({ kind: "contextmenu", id });
  } else if ("key" in request) {
    host.simulate({ kind: "key", keystroke: request.key });
  } else if ("type" in request) {
    host.simulate({ kind: "type", text: request.type });
  } else if ("sim" in request) {
    host.simulate(request.sim);
  } else {
    return { tree: root.lastTree() };
  }
  return { ok: true };
}

/** Listens when `DASHI_APP_CONTROL` is set; returns the function that stops. */
export function serveControl(host: NativeHostTransport, root: NativeRoot, path: string | undefined = process.env.DASHI_APP_CONTROL): () => void {
  if (!path) return () => {};
  try {
    unlinkSync(path);
  } catch {
    // Nothing left over.
  }
  const buffers = new WeakMap<object, string>();
  // Bun writes what the socket takes at once; the rest waits for `drain` (a tree is large).
  const pending = new WeakMap<object, Uint8Array>();
  const flush = (socket: { write(data: Uint8Array): number }): void => {
    const rest = pending.get(socket);
    if (!rest) return;
    const wrote = socket.write(rest);
    if (wrote >= rest.length) pending.delete(socket);
    else pending.set(socket, rest.subarray(Math.max(wrote, 0)));
  };
  const send = (socket: { write(data: Uint8Array): number }, text: string): void => {
    const bytes = new TextEncoder().encode(text);
    const queued = pending.get(socket);
    pending.set(socket, queued ? new Uint8Array([...queued, ...bytes]) : bytes);
    flush(socket);
  };
  const server = Bun.listen({
    unix: path,
    socket: {
      drain(socket) {
        flush(socket);
      },
      data(socket, data) {
        const text = (buffers.get(socket) ?? "") + data.toString();
        const lines = text.split("\n");
        buffers.set(socket, lines.pop() ?? "");
        for (const line of lines) {
          if (!line.trim()) continue;
          const request = parseControl(line);
          const reply = request ? handleControl(request, host, root) : { error: "not a request" };
          send(socket, `${JSON.stringify(reply)}\n`);
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
