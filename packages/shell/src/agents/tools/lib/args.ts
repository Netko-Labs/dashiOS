/**
 * A tool's arguments written once. Each argument is a shape (`@dashi/shape`):
 * the same value gives the JSON Schema `tools/list` shows agents and the check
 * that runs when one calls, so the listing can't promise what the check
 * refuses. `tool()` takes the arguments and a pure `build` from the parsed
 * ones to the `Call`; `properties` and `required` of the `ToolDef` come from
 * the shape.
 *
 * What a refusal says is the tool's own words for an agent ("`path` is
 * required: an absolute path…"), kept on the argument (`says`), not the
 * generic text of a shape.
 */

import { int, type JsonSchema, type ObjOf, obj, optional, reject, type Shape, shape } from "@dashi/shape";
import { fail, parseWindowId, type ToolDef, windowProp } from "../define.ts";
import type { Call, CallError } from "../types.ts";

type Fields = Parameters<typeof obj>[0];

/** What a refusal says: a fixed text, or one that depends on what was given (`undefined`: nothing). */
type Says = string | ((given: unknown) => string);

const said = (says: Says, given: unknown): string => (typeof says === "function" ? says(given) : says);

/** `of` with what agents read of it (`description`) and what a refusal says. */
export function arg<T>(of: Shape<T>, says: Says, description?: string): Shape<T> {
  return shape(
    (value) => {
      const parsed = of.parse(value);
      return parsed.ok ? parsed : reject(said(says, value));
    },
    () => {
      const schema = of.schema();
      if (description === undefined) return schema;
      // An object's description comes right after its type, as the listing has always put it.
      const { type, ...rest } = schema;
      return schema.type === "object" ? { type, description, ...rest } : { ...schema, description };
    },
  );
}

/** An argument read by a function (`null`: refused) and listed as `schema`, for what no library shape says. */
export function custom<T>(schema: JsonSchema, read: (value: unknown) => T | null, says: Says): Shape<T> {
  return shape(
    (value) => {
      const result = read(value);
      return result === null ? reject(said(says, value)) : { ok: true, value: result };
    },
    () => schema,
  );
}

/** A whole number from `min` to `max`, `says` otherwise. */
export const wholeArg = (min: number, max: number, says: Says, description?: string): Shape<number> => arg(int({ min, max }), says, description);

const BAD_WINDOW = (given: unknown): string => `\`${String(given)}\` is not a window id; ids look like "w3".`;

/** The `window` argument: an id from list_windows ("w3"), as the number the compositor knows it by; `description` where it is not the usual one. */
export const windowIdArg = (description?: string): Shape<number> =>
  custom(description === undefined ? windowProp : { ...windowProp, description }, parseWindowId, (given) =>
    typeof given === "string" ? BAD_WINDOW(given) : '`window` is required: an id from list_windows, like "w3".',
  );

export const windowId: Shape<number> = windowIdArg();

/** A window id that may be left out. */
export const optionalWindowId: Shape<number | undefined> = optional(custom(windowProp, parseWindowId, BAD_WINDOW));

/** The `Call` a tool builds from its parsed arguments. */
export interface ToolSpec<F extends Fields> extends Omit<ToolDef, "properties" | "required" | "parse"> {
  args: F;
  build(args: ObjOf<F>): Call | CallError;
}

/** A tool whose arguments are shapes: its listing and its check are one. */
export function tool<F extends Fields>({ args, build, ...rest }: ToolSpec<F>): ToolDef {
  // The names are checked before this (define.ts `checkToolArgs`), so the shape lets none through unread.
  const shaped = obj(args, { strict: false });
  const schema = shaped.schema();
  const properties = schema.properties;
  const required = schema.required;
  return {
    ...rest,
    properties: typeof properties === "object" && properties !== null ? { ...properties } : {},
    ...(Array.isArray(required) && required.length > 0 ? { required: required.filter((name): name is string => typeof name === "string") } : {}),
    parse: (given) => {
      const parsed = shaped.parse(given);
      return parsed.ok ? build(parsed.value) : fail(parsed.error);
    },
  };
}
