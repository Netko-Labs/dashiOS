/**
 * The token items as the shell sees them (docs/secrets.md, "Tokens that stay home"):
 * their shapes, and how a dashi-secretd reply becomes one. Pure: the socket
 * calls stay in vault.ts.
 */

import { isRecord } from "@dashi/shape";

/** A token item as anyone may see it: no token (docs/secrets.md, "Tokens that stay home"). */
export interface TokenSummary {
  id: number;
  /** Agents hold `dashi:<name>`. */
  name: string;
  hosts: string[];
  /** Where the token may go, "Authorization: Bearer {}" first by default: the proxy swaps it in whichever the request sent. */
  headers: string[];
  lastUsed: number | null;
}

export interface NewToken {
  name: string;
  hosts: string[];
  /** Unset: "Authorization: Bearer {}". */
  headers?: string[];
  token: string;
}

export interface TokenChange {
  hosts?: string[];
  headers?: string[];
  /** Empty or absent keeps the token there. */
  token?: string;
}

const DEFAULT_TOKEN_HEADER = "Authorization: Bearer {}";

/** An item's headers from a reply: `headers`, else the one `header` an older dashi-secretd sends. */
export function headersOf(reply: Record<string, unknown>): string[] {
  const listed = Array.isArray(reply.headers) ? reply.headers.filter((h): h is string => typeof h === "string") : [];
  if (listed.length > 0) return listed;
  return [typeof reply.header === "string" ? reply.header : DEFAULT_TOKEN_HEADER];
}

/** The headers as dashi-secretd takes them: one as `header` (as it always was), more as `headers`. */
export const headersField = (headers: readonly string[] | undefined): Record<string, unknown> =>
  !headers || headers.length === 0 ? {} : headers.length === 1 ? { header: headers[0] } : { headers };

export function parseToken(value: unknown): TokenSummary | null {
  if (!isRecord(value)) return null;
  const raw = value;
  const { id, name, hosts, lastUsed } = raw;
  if (typeof id !== "number" || typeof name !== "string" || !Array.isArray(hosts)) return null;
  if (typeof raw.header !== "string" && !Array.isArray(raw.headers)) return null;
  return {
    id,
    name,
    hosts: hosts.filter((h): h is string => typeof h === "string"),
    headers: headersOf(raw),
    lastUsed: typeof lastUsed === "number" ? lastUsed : null,
  };
}
