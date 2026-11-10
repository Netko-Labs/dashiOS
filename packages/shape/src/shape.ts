/**
 * A shape is one value holding what a piece of outside data must look like:
 * `parse` narrows `unknown` to it (never a cast), `schema` says the same as a
 * JSON Schema, and `Infer` gives its TypeScript type. The leaves are here;
 * objects, lists and unions are in compose.ts.
 */

import { accept, type Parsed, reject, ShapeError } from "./refusal.ts";

/** A JSON Schema, as data (draft 2020-12, the parts Dashi uses). */
export type JsonSchema = { readonly [key: string]: unknown };

export interface Shape<T> {
  /** Narrow `value`; `where` names it in a refusal ("params.window"). */
  parse(value: unknown, where?: string): Parsed<T>;
  schema(): JsonSchema;
}

/** A field of `obj` that may be absent. */
export interface OptionalShape<T> extends Shape<T | undefined> {
  readonly optional: true;
}

export type Infer<S> = S extends Shape<infer T> ? T : never;

export const WHERE = "value";

export function shape<T>(parse: (value: unknown, where: string) => Parsed<T>, schema: () => JsonSchema): Shape<T> {
  return { parse: (value, where = WHERE) => parse(value, where), schema };
}

/** The value, or a `ShapeError` naming what was wrong. */
export function must<T>(of: Shape<T>, value: unknown, where?: string): T {
  const parsed = of.parse(value, where);
  if (!parsed.ok) throw new ShapeError(parsed.error);
  return parsed.value;
}

/** The value, or null when it does not have the shape. */
export function maybe<T>(of: Shape<T>, value: unknown): T | null {
  const parsed = of.parse(value);
  return parsed.ok ? parsed.value : null;
}

/** Characters as a person counts them (code points). */
export const length = (text: string): number => [...text].length;

// Control characters, and the bidi overrides that could make a label read as another.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/u;

export interface StrOptions {
  min?: number;
  max?: number;
  pattern?: RegExp;
  /** Trim before the other checks; the value is the trimmed text. */
  trim?: boolean;
  /** Refuse control characters and bidi overrides. */
  safe?: boolean;
}

export function str(options: StrOptions = {}): Shape<string> {
  const { min, max, pattern, trim = false, safe = false } = options;
  return shape(
    (value, where) => {
      if (typeof value !== "string") return reject(`${where} must be a string`);
      const text = trim ? value.trim() : value;
      const count = length(text);
      if (min !== undefined && count < min) return reject(min === 1 ? `${where} is empty` : `${where} is shorter than ${min} characters`);
      if (max !== undefined && count > max) return reject(`${where} is longer than ${max} characters`);
      if (safe && UNSAFE.test(text)) return reject(`${where} has control characters`);
      if (pattern && !pattern.test(text)) return reject(`${where} does not match ${pattern.source}`);
      return accept(text);
    },
    () => ({
      type: "string",
      ...(min !== undefined ? { minLength: min } : {}),
      ...(max !== undefined ? { maxLength: max } : {}),
      ...(pattern ? { pattern: pattern.source } : {}),
    }),
  );
}

export interface Range {
  min?: number;
  max?: number;
}

function numeric(whole: boolean, { min, max }: Range): Shape<number> {
  const kind = whole ? "a whole number" : "a number";
  return shape(
    (value, where) => {
      if (typeof value !== "number" || !Number.isFinite(value) || (whole && !Number.isInteger(value))) return reject(`${where} must be ${kind}`);
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) return reject(`${where} must be from ${min ?? "-∞"} to ${max ?? "∞"}`);
      return accept(value);
    },
    () => ({ type: whole ? "integer" : "number", ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) }),
  );
}

/** A finite number, within `min` and `max` when given. */
export const num = (range: Range = {}): Shape<number> => numeric(false, range);

/** A whole number, within `min` and `max` when given. */
export const int = (range: Range = {}): Shape<number> => numeric(true, range);

export const bool = (): Shape<boolean> =>
  shape(
    (value, where) => (typeof value === "boolean" ? accept(value) : reject(`${where} must be true or false`)),
    () => ({ type: "boolean" }),
  );

type Literal = string | number | boolean | null;

/** One of a few exact values. */
export function literal<const L extends readonly Literal[]>(...values: L): Shape<L[number]> {
  const said = values.map((each) => JSON.stringify(each)).join(", ");
  return shape(
    (value, where) => {
      const found = values.find((each) => each === value);
      return found !== undefined ? accept(found) : reject(`${where} must be one of ${said}`);
    },
    () => (values.length === 1 ? { const: values[0] } : { enum: [...values] }),
  );
}

/** Anything at all (left for the caller to narrow). */
export const unknown = (): Shape<unknown> =>
  shape(
    (value) => accept(value),
    () => ({}),
  );
