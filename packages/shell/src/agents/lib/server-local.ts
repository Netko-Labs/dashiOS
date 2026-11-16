/**
 * A connection to the agents' server from inside the shell: Dashi's own
 * assistant, when the shell drives the model itself (a key, a local model:
 * agents/assistant/). It is a session like any other: the same MCP
 * requests, the same tools, the same checks, consent, activity log and lock
 * rule; only the socket is missing. So what the assistant can do by voice
 * is exactly what an agent on `dashi-mcp` can do.
 */

import { isRecord } from "@dashi/shape";
import type { Peer } from "../peer.ts";
import { Session } from "./session/session.ts";
import type { SessionContext, SessionTask } from "./session/session-types.ts";

export interface LocalLink {
  /** One MCP request; rejects with the server's error. A signal that aborts gives the request up (`notifications/cancelled`). */
  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** The session ends: what it was doing stops and its sheets come down. */
  close(): void;
}

export interface LocalParts {
  sessions: Map<number, Session>;
  context: SessionContext;
  publish(): void;
  nextId(): number;
}

/** Start a session for `task` with no socket; `detail` is what a sheet says of where it runs. */
export function localSession({ sessions, context, publish, nextId }: LocalParts, task: SessionTask, detail: string): LocalLink {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let closed = false;
  let serial = 0;
  const end = (): void => {
    closed = true;
    for (const waiting of pending.values()) waiting.reject(new Error("Stopped."));
    pending.clear();
  };
  const line = (text: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.id !== "number") return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    const error = isRecord(message.error) ? message.error : null;
    if (error) waiting.reject(new Error(typeof error.message === "string" ? error.message : "The request failed."));
    else waiting.resolve(message.result);
  };
  const peer: Peer = { name: task.policy.name, detail, key: `dashi-assistant:${task.id}`, remote: false };
  const session = new Session(
    nextId(),
    peer,
    {
      write(data) {
        buffer += decoder.decode(data, { stream: true });
        for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
          const text = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          if (text.trim()) line(text);
        }
        return data.byteLength;
      },
      terminate: end,
    },
    context,
    (gone) => {
      sessions.delete(gone.id);
      publish();
    },
    // The model behind it reaches this computer only through these tools: it can read no secret another way.
    true,
    task,
  );
  sessions.set(session.id, session);
  publish();
  const send = (message: unknown): void => session.receive(encoder.encode(`${JSON.stringify(message)}\n`));
  return {
    request(method, params, signal) {
      if (closed) return Promise.reject(new Error("Stopped."));
      const id = ++serial;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        signal?.addEventListener(
          "abort",
          () => {
            if (!pending.delete(id)) return;
            send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id } });
            reject(new DOMException("Stopped.", "AbortError"));
          },
          { once: true },
        );
        send({ jsonrpc: "2.0", id, method, params: params ?? {} });
      });
    },
    close() {
      if (!closed) session.stop("disconnected");
    },
  };
}
