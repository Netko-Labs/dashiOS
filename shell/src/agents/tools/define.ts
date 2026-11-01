/**
 * How a tool is written down: its listing for `tools/list`, the scope it
 * needs, and the function that checks its arguments into a `Call`. The
 * listing and the check live side by side, so a tool can't take an argument
 * the check forgets (the check is only given names the listing declares).
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

/** `tools/list` for one tool. */
export function listing(def: ToolDef) {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: { type: "object", properties: def.properties, required: [...(def.required ?? [])], additionalProperties: false },
    annotations: {
      title: def.title,
      readOnlyHint: def.readOnly,
      destructiveHint: def.destructive,
      idempotentHint: def.idempotent ?? def.readOnly,
      openWorldHint: false,
    },
  };
}

export const fail = (message: string): CallError => ({ arguments: message });

export function isCallError(value: object): value is CallError {
  return "unknown" in value || "arguments" in value;
}

/** The first of `args`' names that `allowed` doesn't list. */
export const stray = (args: Args, allowed: Record<string, unknown>): string | undefined => Object.keys(args).find((key) => !(key in allowed));

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

/** The `window` argument: an id from list_windows. */
export function windowArg(args: Args): number | CallError {
  if (typeof args.window !== "string") return fail('`window` is required: an id from list_windows, like "w3".');
  return parseWindowId(args.window) ?? fail(`\`${args.window}\` is not a window id; ids look like "w3".`);
}
