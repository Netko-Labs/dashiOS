/**
 * Values to wire bytes (little endian). The writer follows the alignment
 * rules (every value starts on a multiple of its own size, measured from the
 * start of the message) and refuses values that don't fit their type, so what
 * leaves here is always well formed.
 *
 * JS side of each type: integers are numbers (`x` and `t` take bigints or safe
 * integers), `b` a boolean, `s`/`o`/`g` strings, `ay` a Uint8Array, other
 * arrays arrays, structs arrays, dicts a Map (or a plain object for string
 * keys), `v` a `Variant`.
 */

import { ProtocolError } from "./errors.ts";
import { isObjectPath } from "./names.ts";
import { alignOf, type BasicCode, type DBusType, elementAlign, parseSignature, parseSingle } from "./signature.ts";
import { Variant } from "./variant.ts";

/** The most the specification allows in one array. */
export const MAX_ARRAY_BYTES = 1 << 26;
export const MAX_MESSAGE = 1 << 27;

const encoder = new TextEncoder();

export class Writer {
  private bytes = new Uint8Array(256);
  private view = new DataView(this.bytes.buffer);
  length = 0;

  constructor(private readonly limit = MAX_MESSAGE) {}

  private reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed > this.limit) throw new ProtocolError("message is too large to send");
    if (needed <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(needed, this.bytes.length * 2));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }

  align(to: number): void {
    const pad = (to - (this.length % to)) % to;
    if (pad === 0) return;
    this.reserve(pad);
    this.bytes.fill(0, this.length, this.length + pad);
    this.length += pad;
  }

  u8(value: number): void {
    this.reserve(1);
    this.view.setUint8(this.length++, value);
  }

  u16(value: number): void {
    this.align(2);
    this.reserve(2);
    this.view.setUint16(this.length, value, true);
    this.length += 2;
  }

  i16(value: number): void {
    this.align(2);
    this.reserve(2);
    this.view.setInt16(this.length, value, true);
    this.length += 2;
  }

  u32(value: number): void {
    this.align(4);
    this.reserve(4);
    this.view.setUint32(this.length, value, true);
    this.length += 4;
  }

  i32(value: number): void {
    this.align(4);
    this.reserve(4);
    this.view.setInt32(this.length, value, true);
    this.length += 4;
  }

  u64(value: bigint): void {
    this.align(8);
    this.reserve(8);
    this.view.setBigUint64(this.length, value, true);
    this.length += 8;
  }

  i64(value: bigint): void {
    this.align(8);
    this.reserve(8);
    this.view.setBigInt64(this.length, value, true);
    this.length += 8;
  }

  f64(value: number): void {
    this.align(8);
    this.reserve(8);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  raw(data: Uint8Array): void {
    this.reserve(data.length);
    this.bytes.set(data, this.length);
    this.length += data.length;
  }

  /** Overwrite four bytes already written (an array's length, a header's body size). */
  patchU32(at: number, value: number): void {
    this.view.setUint32(at, value, true);
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length);
  }
}

function integer(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${what} must be an integer from ${min} to ${max}, got ${String(value)}`);
  }
  return value;
}

function wide(value: unknown, signed: boolean, what: string): bigint {
  const big = typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : value;
  if (typeof big !== "bigint") throw new TypeError(`${what} must be a bigint or a safe integer`);
  const fits = signed ? BigInt.asIntN(64, big) === big : BigInt.asUintN(64, big) === big;
  if (!fits) throw new TypeError(`${what} is out of range`);
  return big;
}

function text(value: unknown, what: string): Uint8Array {
  if (typeof value !== "string") throw new TypeError(`${what} must be a string`);
  if (value.includes("\0")) throw new TypeError(`${what} must not contain NUL`);
  return encoder.encode(value);
}

function writeBasic(w: Writer, code: BasicCode, value: unknown): void {
  switch (code) {
    case "y":
      return w.u8(integer(value, 0, 0xff, "byte"));
    case "b":
      if (typeof value !== "boolean") throw new TypeError("boolean must be true or false");
      return w.u32(value ? 1 : 0);
    case "n":
      return w.i16(integer(value, -0x8000, 0x7fff, "int16"));
    case "q":
      return w.u16(integer(value, 0, 0xffff, "uint16"));
    case "i":
      return w.i32(integer(value, -0x80000000, 0x7fffffff, "int32"));
    case "u":
    case "h":
      return w.u32(integer(value, 0, 0xffffffff, "uint32"));
    case "x":
      return w.i64(wide(value, true, "int64"));
    case "t":
      return w.u64(wide(value, false, "uint64"));
    case "d":
      if (typeof value !== "number") throw new TypeError("double must be a number");
      return w.f64(value);
    case "s":
    case "o": {
      const bytes = text(value, code === "s" ? "string" : "object path");
      if (code === "o" && !isObjectPath(value as string)) throw new TypeError(`"${value}" is not an object path`);
      w.u32(bytes.length);
      w.raw(bytes);
      return w.u8(0);
    }
    case "g": {
      const bytes = text(value, "signature");
      parseSignature(value as string);
      w.u8(bytes.length);
      w.raw(bytes);
      return w.u8(0);
    }
  }
}

/** A dict's entries from a Map, a plain object, or a list of pairs. */
function entriesOf(value: unknown): Array<[unknown, unknown]> {
  if (value instanceof Map) return [...value.entries()];
  if (Array.isArray(value)) {
    return value.map((pair): [unknown, unknown] => {
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("dict entries must be [key, value] pairs");
      return [pair[0], pair[1]];
    });
  }
  if (typeof value === "object" && value !== null) return Object.entries(value);
  throw new TypeError("dict must be a Map, an object, or a list of pairs");
}

function writeArray(w: Writer, type: DBusType & { kind: "array" | "dict" }, value: unknown): void {
  w.u32(0);
  const lengthAt = w.length - 4;
  w.align(elementAlign(type));
  const start = w.length;
  if (type.kind === "dict") {
    for (const [key, entry] of entriesOf(value)) {
      w.align(8);
      writeBasic(w, type.key.code, key);
      writeValue(w, type.value, entry);
    }
  } else if (type.element.kind === "basic" && type.element.code === "y" && value instanceof Uint8Array) {
    w.raw(value);
  } else {
    if (!Array.isArray(value)) throw new TypeError("array must be an Array");
    for (const item of value) writeValue(w, type.element, item);
  }
  const size = w.length - start;
  if (size > MAX_ARRAY_BYTES) throw new ProtocolError("array is longer than the specification allows");
  w.patchU32(lengthAt, size);
}

function writeValue(w: Writer, type: DBusType, value: unknown): void {
  switch (type.kind) {
    case "basic":
      return writeBasic(w, type.code, value);
    case "variant": {
      if (!(value instanceof Variant)) throw new TypeError("variant must be a Variant");
      const inner = parseSingle(value.signature);
      w.u8(value.signature.length);
      w.raw(encoder.encode(value.signature));
      w.u8(0);
      return writeValue(w, inner, value.value);
    }
    case "array":
    case "dict":
      return writeArray(w, type, value);
    case "struct": {
      if (!Array.isArray(value) || value.length !== type.fields.length) {
        throw new TypeError(`struct must be an Array of ${type.fields.length} values`);
      }
      w.align(alignOf(type));
      for (const [index, field] of type.fields.entries()) writeValue(w, field, value[index]);
    }
  }
}

/** Marshal `values` as the types `signature` lists, appending to `into`. */
export function marshal(signature: string, values: readonly unknown[], into = new Writer()): Writer {
  const types = parseSignature(signature);
  if (types.length !== values.length) {
    throw new TypeError(`signature "${signature}" takes ${types.length} values, got ${values.length}`);
  }
  for (const [index, type] of types.entries()) writeValue(into, type, values[index]);
  return into;
}
