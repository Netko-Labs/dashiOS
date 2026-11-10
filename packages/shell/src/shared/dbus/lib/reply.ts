/**
 * Reading a method reply: the one way to turn the values a call answers with
 * into a typed value. A reply is data from another process, so it is parsed
 * with a shape, never cast; a reply of the wrong kind rejects with a
 * `ProtocolError` that names the call and the field (H7).
 *
 *     const owner = await connection.read(spec, value(str()));
 *     const [name, size] = await connection.read(spec, values(str(), int()));
 */

import { accept, type Infer, reject, type Shape, shape } from "@dashi/shape";
import { ProtocolError } from "./errors.ts";
import { Variant } from "./variant.ts";

type Tuple<S extends readonly Shape<unknown>[]> = { [K in keyof S]: Infer<S[K]> };

/** A reply of these values in order (more values than listed are left alone). */
export function values<const S extends readonly Shape<unknown>[]>(...parts: S): Shape<Tuple<S>> {
  return shape(
    (body, where) => {
      if (!Array.isArray(body)) return reject(`${where} must be a list of values`);
      if (body.length < parts.length) return reject(`${where} has ${body.length} values, not ${parts.length}`);
      const out: unknown[] = [];
      for (const [at, part] of parts.entries()) {
        const parsed = part.parse(body[at], `${where}[${at}]`);
        if (!parsed.ok) return parsed;
        out.push(parsed.value);
      }
      return accept(out as Tuple<S>);
    },
    () => ({ type: "array", prefixItems: parts.map((part) => part.schema()) }),
  );
}

/** A reply of one value. */
export function value<T>(of: Shape<T>): Shape<T> {
  const only = values(of);
  return shape(
    (body, where) => {
      const parsed = only.parse(body, where);
      return parsed.ok ? accept(parsed.value[0]) : parsed;
    },
    () => of.schema(),
  );
}

/** A variant (`v`) holding a value of this shape. */
export function variantOf<T>(of: Shape<T>): Shape<T> {
  return shape(
    (held, where) => (held instanceof Variant ? of.parse(held.value, `${where} (variant)`) : reject(`${where} must be a variant`)),
    () => of.schema(),
  );
}

/** The reply's values as `of` says, or a `ProtocolError` naming `member`. */
export function readReply<T>(member: string, body: readonly unknown[], of: Shape<T>): T {
  const parsed = of.parse(body, `${member} reply`);
  if (!parsed.ok) throw new ProtocolError(parsed.error);
  return parsed.value;
}
