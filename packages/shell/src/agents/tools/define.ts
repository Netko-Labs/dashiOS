/**
 * How a tool is written down: its arguments for `tools/list`, the scope it
 * needs, and the function that checks its arguments into a `Call`. Tools are
 * written with `tool()` (args.ts), whose arguments are shapes: the schema and
 * the check are one value, so a tool can't list what the check refuses (the
 * check is only given names the schema declares).
 * Each tool becomes an action (actions/tools.ts), and `tools/list` is
 * written from the actions (`mcpListing`).
 *
 * Every tool states `readOnlyHint` and `destructiveHint`: MCP treats a tool
 * that says neither as destructive.
 */

import type { Scope } from "../consent.ts";
import type { Call, CallError, ToolName } from "./types.ts";

/** A tool call's `arguments`, as untrusted as anything from outside. */
export type Args = Record<string, unknown>;

export interface ToolDef {
  name: ToolName;
  title: string;
  description: string;
  /** What the person must have allowed before it runs. */
  scope: Scope;
  readOnly: boolean;
  destructive: boolean;
  /** Calling again with the same arguments changes nothing more; read-only tools are. */
  idempotent?: boolean;
  properties: Record<string, unknown>;
  required?: readonly string[];
  /** `args` holds only names in `properties`; the values are still untrusted. */
  parse(args: Args): Call | CallError;
}

export const fail = (message: string): CallError => ({ arguments: message });

export function isCallError(value: object): value is CallError {
  return "unknown" in value || "arguments" in value;
}

/** The first of `args`' names that `allowed` doesn't list. */
export const stray = (args: Args, allowed: Record<string, unknown>): string | undefined => Object.keys(args).find((key) => !(key in allowed));

/**
 * A tool's `arguments` (anything an agent, a person, or a link sent) checked
 * into its `Call`: an object, only names the tool declares, then its own
 * `parse`. The agents' `tools/call` and a person's command go through this one.
 */
export function checkToolArgs(tool: ToolDef, given: unknown): Call | CallError {
  if (given !== undefined && given !== null && (typeof given !== "object" || Array.isArray(given))) return fail("`arguments` must be an object.");
  const args = (given ?? {}) as Args;
  const extra = stray(args, tool.properties);
  if (extra !== undefined) {
    const takes = Object.keys(tool.properties);
    return fail(`\`${extra}\` is not an argument of ${tool.name}; ${takes.length > 0 ? `it takes ${takes.join(", ")}` : "it takes none"}.`);
  }
  return tool.parse(args);
}

/** `value` if it is a whole number from `min` to `max`. */
export function whole(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export const windowProp = { type: "string", description: 'A window id from list_windows, like "w3".' };

/** "w3" (or "3") to 3. */
export function parseWindowId(id: unknown): number | null {
  if (typeof id !== "string") return null;
  const digits = id.startsWith("w") ? id.slice(1) : id;
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}
