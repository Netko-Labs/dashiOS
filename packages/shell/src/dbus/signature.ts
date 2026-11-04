/**
 * Type signatures: parsed into a small type tree that the marshaller and the
 * unmarshaller walk. The limits are the specification's (255 bytes, 32 levels
 * of arrays, 32 of structs), so a hostile signature can't make us recurse
 * without bound.
 */

import { ProtocolError } from "./errors.ts";

export type BasicCode = "y" | "b" | "n" | "q" | "i" | "u" | "x" | "t" | "d" | "s" | "o" | "g" | "h";

export type DBusType =
  | { kind: "basic"; code: BasicCode }
  | { kind: "variant" }
  | { kind: "array"; element: DBusType }
  /** `a{kv}`: an array of dict entries, read and written as a Map. */
  | { kind: "dict"; key: DBusType & { kind: "basic" }; value: DBusType }
  | { kind: "struct"; fields: DBusType[] };

export const MAX_SIGNATURE = 255;
const MAX_ARRAY_DEPTH = 32;
const MAX_STRUCT_DEPTH = 32;

const BASIC: ReadonlySet<string> = new Set("ybnqiuxtdsogh");

const BASIC_ALIGN: Readonly<Record<BasicCode, number>> = {
  y: 1,
  b: 4,
  n: 2,
  q: 2,
  i: 4,
  u: 4,
  x: 8,
  t: 8,
  d: 8,
  s: 4,
  o: 4,
  g: 1,
  h: 4,
};

/** The alignment of a value of this type on the wire. */
export function alignOf(type: DBusType): number {
  switch (type.kind) {
    case "basic":
      return BASIC_ALIGN[type.code];
    case "variant":
      return 1;
    case "array":
    case "dict":
      return 4;
    case "struct":
      return 8;
  }
}

/** The alignment of an array's elements (a dict entry aligns like a struct). */
export function elementAlign(type: DBusType & { kind: "array" | "dict" }): number {
  return type.kind === "dict" ? 8 : alignOf(type.element);
}

interface Depth {
  array: number;
  struct: number;
}

function parseOne(sig: string, at: number, depth: Depth): [DBusType, number] {
  const char = sig[at];
  if (char === undefined) throw new ProtocolError(`signature "${sig}" ends inside a type`);
  if (BASIC.has(char)) return [{ kind: "basic", code: char as BasicCode }, at + 1];
  if (char === "v") return [{ kind: "variant" }, at + 1];
  if (char === "a") {
    if (depth.array >= MAX_ARRAY_DEPTH) throw new ProtocolError("signature nests arrays too deep");
    if (sig[at + 1] === "{") {
      if (depth.struct >= MAX_STRUCT_DEPTH) throw new ProtocolError("signature nests structs too deep");
      const keyAt = at + 2;
      const keyCode = sig[keyAt];
      if (keyCode === undefined || !BASIC.has(keyCode)) {
        throw new ProtocolError(`signature "${sig}" has a dict key that is not a basic type`);
      }
      const [value, next] = parseOne(sig, keyAt + 1, { array: depth.array + 1, struct: depth.struct + 1 });
      if (sig[next] !== "}") throw new ProtocolError(`signature "${sig}" has a malformed dict entry`);
      return [{ kind: "dict", key: { kind: "basic", code: keyCode as BasicCode }, value }, next + 1];
    }
    const [element, next] = parseOne(sig, at + 1, { array: depth.array + 1, struct: depth.struct });
    return [{ kind: "array", element }, next];
  }
  if (char === "(") {
    if (depth.struct >= MAX_STRUCT_DEPTH) throw new ProtocolError("signature nests structs too deep");
    const fields: DBusType[] = [];
    let next = at + 1;
    while (sig[next] !== ")") {
      if (next >= sig.length) throw new ProtocolError(`signature "${sig}" has an unclosed struct`);
      const [field, after] = parseOne(sig, next, { array: depth.array, struct: depth.struct + 1 });
      fields.push(field);
      next = after;
    }
    if (fields.length === 0) throw new ProtocolError("signature has an empty struct");
    return [{ kind: "struct", fields }, next + 1];
  }
  throw new ProtocolError(`signature "${sig}" has an unknown type code "${char}"`);
}

const cache = new Map<string, DBusType[]>();
const CACHE_LIMIT = 256;

/** The complete types a signature lists, in order. Throws `ProtocolError` if it is invalid. */
export function parseSignature(sig: string): DBusType[] {
  const cached = cache.get(sig);
  if (cached) return cached;
  if (sig.length > MAX_SIGNATURE) throw new ProtocolError("signature is longer than 255 bytes");
  const types: DBusType[] = [];
  let at = 0;
  while (at < sig.length) {
    const [type, next] = parseOne(sig, at, { array: 0, struct: 0 });
    types.push(type);
    at = next;
  }
  // Signatures come off the wire, so the cache must not grow with them.
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(sig, types);
  return types;
}

/** The one complete type a signature names (a variant's contents). */
export function parseSingle(sig: string): DBusType {
  const types = parseSignature(sig);
  const [type] = types;
  if (types.length !== 1 || !type) throw new ProtocolError(`"${sig}" is not a single complete type`);
  return type;
}

export function isValidSignature(sig: string): boolean {
  try {
    parseSignature(sig);
    return true;
  } catch {
    return false;
  }
}

/** The complete types a signature lists, each as its own signature (`"sa{sv}u"` gives `s`, `a{sv}`, `u`). */
export function splitSignature(sig: string): string[] {
  parseSignature(sig);
  const parts: string[] = [];
  let at = 0;
  while (at < sig.length) {
    const [, next] = parseOne(sig, at, { array: 0, struct: 0 });
    parts.push(sig.slice(at, next));
    at = next;
  }
  return parts;
}
