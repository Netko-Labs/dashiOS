/**
 * Shapes made of shapes: objects, lists, records, unions, and the small
 * wrappers (optional, nullable, a default, a mapping). Lists refuse at the
 * first bad entry and name it; `lenientList` drops bad entries, for lists of
 * things on screen where losing one is harmless; each call site says which.
 */

import { accept, isRecord, type Parsed, reject } from "./refusal.ts";
import { type Infer, type OptionalShape, type Shape, shape } from "./shape.ts";

// biome-ignore lint/suspicious/noExplicitAny: a field map holds shapes of any type; each is inferred from its own.
type Fields = Record<string, Shape<any>>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type IsOptional<S> = S extends { readonly optional: true } ? true : false;

export type ObjOf<F extends Fields> = Simplify<
  { [K in keyof F as IsOptional<F[K]> extends true ? never : K]: Infer<F[K]> } & {
    [K in keyof F as IsOptional<F[K]> extends true ? K : never]?: Exclude<Infer<F[K]>, undefined>;
  }
>;

export interface ObjOptions {
  /** Refuse a field not named (the default); otherwise it is dropped. */
  strict?: boolean;
}

const isOptional = (of: Shape<unknown>): boolean => "optional" in of && of.optional === true;

function readFields<F extends Fields>(fields: F, value: Record<string, unknown>, where: string): Parsed<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, of] of Object.entries(fields)) {
    const parsed = of.parse(value[key], `${where}.${key}`);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) out[key] = parsed.value;
  }
  return accept(out);
}

/** An object with these fields; `optional(…)` fields may be absent. */
export function obj<F extends Fields>(fields: F, options: ObjOptions = {}): Shape<ObjOf<F>> {
  const strict = options.strict ?? true;
  return shape(
    (value, where) => {
      if (!isRecord(value)) return reject(`${where} must be an object`);
      const stray = strict ? Object.keys(value).find((key) => !(key in fields)) : undefined;
      if (stray !== undefined) return reject(`${where} has an unknown field “${stray}”`);
      return readFields(fields, value, where) as Parsed<ObjOf<F>>;
    },
    () => ({
      type: "object",
      properties: Object.fromEntries(Object.entries(fields).map(([key, of]) => [key, of.schema()])),
      required: Object.keys(fields).filter((key) => !isOptional(fields[key] as Shape<unknown>)),
      ...(strict ? { additionalProperties: false } : {}),
    }),
  );
}

/** A field that may be absent (`undefined` too). */
export function optional<T>(of: Shape<T>): OptionalShape<T> {
  return {
    optional: true,
    parse: (value, where) => (value === undefined ? accept(undefined) : of.parse(value, where)),
    schema: () => of.schema(),
  };
}

/** `fallback` when absent; the field is then always there after parsing. */
export function withDefault<T>(of: Shape<T>, fallback: NoInfer<T>): Shape<T> {
  return shape(
    (value, where) => (value === undefined ? accept(fallback) : of.parse(value, where)),
    () => ({ ...of.schema(), default: fallback }),
  );
}

/**
 * `fallback` when absent, and when it does not have the shape: for a file of
 * the person's own settings or state, where one bad field must not lose the
 * rest. Never for a request: what asks for something is refused, not guessed.
 */
export function orElse<T>(of: Shape<T>, fallback: NoInfer<T>): Shape<T> {
  return shape(
    (value, where) => {
      const parsed = of.parse(value, where);
      return parsed.ok ? parsed : accept(fallback);
    },
    () => ({ ...of.schema(), default: fallback }),
  );
}

export function nullable<T>(of: Shape<T>): Shape<T | null> {
  return shape(
    (value, where) => (value === null ? accept(null) : of.parse(value, where)),
    () => ({ anyOf: [of.schema(), { type: "null" }] }),
  );
}

export interface ListOptions {
  max?: number;
}

/** A list, each entry parsed; the first bad entry refuses the whole, by its index. */
export function list<T>(of: Shape<T>, { max }: ListOptions = {}): Shape<T[]> {
  return shape(
    (value, where) => {
      if (!Array.isArray(value)) return reject(`${where} must be a list`);
      if (max !== undefined && value.length > max) return reject(`${where} has more than ${max} entries`);
      const out: T[] = [];
      for (const [at, entry] of value.entries()) {
        const parsed = of.parse(entry, `${where}[${at}]`);
        if (!parsed.ok) return parsed;
        out.push(parsed.value);
      }
      return accept(out);
    },
    () => ({ type: "array", items: of.schema(), ...(max !== undefined ? { maxItems: max } : {}) }),
  );
}

/** A list whose bad entries are dropped, and cut to `max`: only for lists where losing one entry is harmless. */
export function lenientList<T>(of: Shape<T>, { max }: ListOptions = {}): Shape<T[]> {
  return shape(
    (value, where) => {
      if (!Array.isArray(value)) return reject(`${where} must be a list`);
      const out: T[] = [];
      for (const [at, entry] of value.entries()) {
        const parsed = of.parse(entry, `${where}[${at}]`);
        if (parsed.ok) out.push(parsed.value);
      }
      return accept(max === undefined ? out : out.slice(0, max));
    },
    () => ({ type: "array", items: of.schema() }),
  );
}

export interface RecordOptions {
  key?: Shape<string>;
  max?: number;
}

/** An object used as a map: any keys (each checked by `key`), every value one shape. */
export function record<T>(of: Shape<T>, { key, max }: RecordOptions = {}): Shape<Record<string, T>> {
  return shape(
    (value, where) => {
      if (!isRecord(value)) return reject(`${where} must be an object`);
      const entries = Object.entries(value);
      if (max !== undefined && entries.length > max) return reject(`${where} has more than ${max} entries`);
      const out: Record<string, T> = {};
      for (const [name, entry] of entries) {
        const named = key ? key.parse(name, `${where} key “${name}”`) : accept(name);
        if (!named.ok) return named;
        const parsed = of.parse(entry, `${where}.${name}`);
        if (!parsed.ok) return parsed;
        out[named.value] = parsed.value;
      }
      return accept(out);
    },
    () => ({ type: "object", additionalProperties: of.schema(), ...(key ? { propertyNames: key.schema() } : {}) }),
  );
}

// biome-ignore lint/suspicious/noExplicitAny: the members of a union are shapes of any type.
type Members = readonly Shape<any>[];

/** The first member that parses; refused with every member's reason otherwise. */
export function union<const M extends Members>(...members: M): Shape<Infer<M[number]>> {
  return shape(
    (value, where) => {
      const reasons: string[] = [];
      for (const member of members) {
        const parsed = member.parse(value, where);
        if (parsed.ok) return parsed;
        reasons.push(parsed.error);
      }
      return reject(reasons.length === 1 ? (reasons[0] ?? "") : `${where} matches none of: ${reasons.join("; ")}`);
    },
    () => ({ anyOf: members.map((member) => member.schema()) }),
  );
}

type Tagged<K extends string, V extends Record<string, Shape<object>>> = {
  [T in keyof V & string]: Simplify<{ [P in K]: T } & Infer<V[T]>>;
}[keyof V & string];

/** A union told apart by one field (`event`, `type`, `kind`): each variant parsed by the shape under its tag. */
export function tagged<K extends string, V extends Record<string, Shape<object>>>(tag: K, variants: V): Shape<Tagged<K, V>> {
  const names = Object.keys(variants);
  return shape(
    (value, where) => {
      if (!isRecord(value)) return reject(`${where} must be an object`);
      const name = value[tag];
      const variant = typeof name === "string" && Object.hasOwn(variants, name) ? variants[name] : undefined;
      if (!variant || typeof name !== "string") return reject(`${where}.${tag} must be one of ${names.map((each) => `“${each}”`).join(", ")}`);
      const { [tag]: _, ...rest } = value;
      const parsed = variant.parse(rest, where);
      return parsed.ok ? accept({ [tag]: name, ...parsed.value } as Tagged<K, V>) : parsed;
    },
    () => ({
      oneOf: names.map((name) => {
        const schema = (variants[name] as Shape<object>).schema();
        const properties = { [tag]: { const: name }, ...(isRecord(schema.properties) ? schema.properties : {}) };
        const required = [tag, ...(Array.isArray(schema.required) ? schema.required : [])];
        return { ...schema, properties, required };
      }),
    }),
  );
}

/** A shape whose value is turned into another once parsed (the schema is the input's). */
export function map<T, U>(of: Shape<T>, into: (value: T) => U): Shape<U> {
  return shape(
    (value, where) => {
      const parsed = of.parse(value, where);
      return parsed.ok ? accept(into(parsed.value)) : parsed;
    },
    () => of.schema(),
  );
}

/** A shape with one more rule: `check` answers why not, or null. */
export function refine<T>(of: Shape<T>, check: (value: T, where: string) => string | null): Shape<T> {
  return shape(
    (value, where) => {
      const parsed = of.parse(value, where);
      if (!parsed.ok) return parsed;
      const why = check(parsed.value, where);
      return why === null ? parsed : reject(why);
    },
    () => of.schema(),
  );
}
