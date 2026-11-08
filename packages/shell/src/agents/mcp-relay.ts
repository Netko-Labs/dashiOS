/**
 * What `dashi-mcp --reconnect` (bin/dashi-mcp.ts) keeps so an agent's MCP
 * connection outlives the shell restarting: a launcher run's harness keeps
 * working while the shell is gone (docs/actions.md, "Agents from the
 * launcher"), and its bridge connects again once the shell is back. The
 * client's `initialize` (and `notifications/initialized`) are said again on
 * the new connection, their answer kept from the client, which never knows;
 * a request that was on its way when the shell went gets an error, so the
 * harness isn't left waiting for an answer that can't come. Pure: lines in,
 * lines out (tested).
 */

/** The error a request on its way when Dashi went gets (JSON-RPC's server error range). */
export const LOST_CODE = -32000;
export const LOST_MESSAGE = "Dashi restarted before this finished. Try it again.";

type Id = string | number;

interface Message {
  id?: unknown;
  method?: unknown;
}

const isId = (value: unknown): value is Id => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

function parse(line: string): Message | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Message) : null;
  } catch {
    return null;
  }
}

export class McpRelay {
  private initialize: Record<string, unknown> | null = null;
  private initialized: string | null = null;
  /** Requests from the client not answered yet, by their id's JSON. */
  private readonly pending = new Map<string, Id>();
  /** The id of the `initialize` said again, whose answer the client never sees. */
  private again: string | null = null;
  private times = 0;

  /** A line the client sent, on its way to Dashi. */
  fromClient(line: string): void {
    const message = parse(line);
    if (!message) return;
    if (message.method === "initialize" && this.initialize === null) this.initialize = message as Record<string, unknown>;
    if (message.method === "notifications/initialized") this.initialized = line;
    if (typeof message.method === "string" && isId(message.id)) this.pending.set(JSON.stringify(message.id), message.id);
  }

  /** A line from Dashi: false when it is the answer to the `initialize` said again, which the client mustn't see. */
  fromServer(line: string): boolean {
    const message = parse(line);
    if (!message || message.method !== undefined || !isId(message.id)) return true;
    const key = JSON.stringify(message.id);
    if (key === this.again) {
      this.again = null;
      return false;
    }
    this.pending.delete(key);
    return true;
  }

  /** Dashi went: an error line for each request on its way, which will never be answered. */
  lost(): string[] {
    const lines = [...this.pending.values()].map((id) => JSON.stringify({ jsonrpc: "2.0", id, error: { code: LOST_CODE, message: LOST_MESSAGE } }));
    this.pending.clear();
    return lines;
  }

  /** Connected again: what to say first, the client's `initialize` (under an id of the bridge's) and `notifications/initialized`. */
  reconnected(): string[] {
    if (!this.initialize) return [];
    const id = `dashi-mcp-again-${++this.times}`;
    this.again = JSON.stringify(id);
    return [JSON.stringify({ ...this.initialize, id }), ...(this.initialized ? [this.initialized] : [])];
  }
}
