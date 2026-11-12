/**
 * JSON-RPC 2.0 as MCP frames it: one message per line. A line becomes a
 * request, a notification, or an error to send back; nothing a client sends
 * can throw out of here.
 */

import { isRecord } from "@dashi/shape";

/** MCP revisions spoken here, newest first. Clients on 2026-07-28 probe
 * `server/discover` first; "method not found" makes them fall back to
 * `initialize` with one of these. */
export const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

export type Id = string | number;

export type Incoming =
  | { kind: "request"; id: Id; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string; params: Record<string, unknown> }
  | { kind: "response" }
  | { kind: "invalid"; id: Id | null; code: number; message: string };

const isId = (value: unknown): value is Id => typeof value === "string" || (typeof value === "number" && Number.isInteger(value));

export function parse(line: string): Incoming {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: "invalid", id: null, code: PARSE_ERROR, message: "Parse error" };
  }
  const invalid = (id: Id | null): Incoming => ({ kind: "invalid", id, code: INVALID_REQUEST, message: "Invalid request" });
  // Arrays (batches) left MCP in 2025-06-18.
  if (!isRecord(value)) return invalid(null);
  const message = value;
  const id = isId(message.id) ? message.id : null;
  if (message.jsonrpc !== "2.0") return invalid(id);
  const hasId = "id" in message;
  if (typeof message.method === "string") {
    const params = isRecord(message.params) ? message.params : {};
    if (!hasId) return { kind: "notification", method: message.method, params };
    if (id === null) return invalid(null);
    return { kind: "request", id, method: message.method, params };
  }
  if (hasId && ("result" in message || "error" in message)) return { kind: "response" };
  return invalid(id);
}

/** The request a `notifications/cancelled` gives up on (the client stopped waiting), if this is one. */
export function cancelledRequest(incoming: Incoming): Id | null {
  if (incoming.kind !== "notification" || incoming.method !== "notifications/cancelled") return null;
  const requestId = incoming.params.requestId;
  return isId(requestId) ? requestId : null;
}

/** A success reply. */
export interface ResultReply {
  jsonrpc: "2.0";
  id: Id | null;
  result: unknown;
}

/** An error reply. */
export interface ErrorReply {
  jsonrpc: "2.0";
  id: Id | null;
  error: { code: number; message: string };
}

export const result = (id: Id | null, value: unknown): ResultReply => ({ jsonrpc: "2.0", id, result: value });
export const error = (id: Id | null, code: number, message: string): ErrorReply => ({ jsonrpc: "2.0", id, error: { code, message } });

/** The revision to answer `initialize` with: the client's if spoken here,
 * otherwise the newest (the client then decides whether to go on). */
export function negotiate(requested: unknown): string {
  return VERSIONS.find((version) => version === requested) ?? VERSIONS[0];
}
