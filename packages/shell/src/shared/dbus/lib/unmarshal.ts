/**
 * Wire bytes to values, for bytes that came from a peer and so are suspect.
 * Every read is bounds-checked against the end of the data (or of the array
 * being read), padding must be zero, strings must be UTF-8 without NUL,
 * booleans 0 or 1, and nesting is capped, so a hostile message ends in a
 * `ProtocolError` and never in a crash, a huge allocation, or a loop.
 *
 * The JS side of each type is described in marshal.ts; 64-bit integers come
 * back as bigints, dicts as Maps, `ay` as a Uint8Array.
 */

import { ProtocolError } from "../errors.ts";
import { isObjectPath } from "../names.ts";
import { Variant } from "../variant.ts";
import { MAX_ARRAY_BYTES } from "./marshal.ts";
import { alignOf, type BasicCode, type DBusType, elementAlign, parseSignature, parseSingle } from "./signature.ts";

/** Containers nested through variants as well as types; the specification allows 64. */
const MAX_DEPTH = 64;

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class Reader {
  private readonly view: DataView;
  private depth = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly little: boolean,
    /** Where reading starts; alignment is measured from the start of `data`. */
    public pos = 0,
    private end = data.length,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.end - this.pos;
  }

  private need(count: number): void {
    if (count < 0 || count > this.end - this.pos) throw new ProtocolError("message ends in the middle of a value");
  }

  align(to: number): void {
    const pad = (to - (this.pos % to)) % to;
    if (pad === 0) return;
    this.need(pad);
    for (let i = 0; i < pad; i++) {
      if (this.data[this.pos + i] !== 0) throw new ProtocolError("padding is not zero");
    }
    this.pos += pad;
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  u32(): number {
    this.align(4);
    this.need(4);
    const value = this.view.getUint32(this.pos, this.little);
    this.pos += 4;
    return value;
  }

  private basic(code: BasicCode): unknown {
    switch (code) {
      case "y":
        return this.u8();
      case "b": {
        const value = this.u32();
        if (value > 1) throw new ProtocolError("boolean is neither 0 nor 1");
        return value === 1;
      }
      case "n": {
        this.align(2);
        this.need(2);
        const value = this.view.getInt16(this.pos, this.little);
        this.pos += 2;
        return value;
      }
      case "q": {
        this.align(2);
        this.need(2);
        const value = this.view.getUint16(this.pos, this.little);
        this.pos += 2;
        return value;
      }
      case "i": {
        this.align(4);
        this.need(4);
        const value = this.view.getInt32(this.pos, this.little);
        this.pos += 4;
        return value;
      }
      case "u":
      case "h":
        return this.u32();
      case "x": {
        this.align(8);
        this.need(8);
        const value = this.view.getBigInt64(this.pos, this.little);
        this.pos += 8;
        return value;
      }
      case "t": {
        this.align(8);
        this.need(8);
        const value = this.view.getBigUint64(this.pos, this.little);
        this.pos += 8;
        return value;
      }
      case "d": {
        this.align(8);
        this.need(8);
        const value = this.view.getFloat64(this.pos, this.little);
        this.pos += 8;
        return value;
      }
      case "s":
      case "o":
        return this.string(this.u32(), code === "o");
      case "g": {
        const signature = this.string(this.u8(), false);
        parseSignature(signature);
        return signature;
      }
    }
  }

  /** `length` bytes of UTF-8, then the NUL that ends every string. */
  private string(length: number, objectPath: boolean): string {
    this.need(length + 1);
    const bytes = this.data.subarray(this.pos, this.pos + length);
    if (this.data[this.pos + length] !== 0) throw new ProtocolError("string is not NUL terminated");
    if (bytes.includes(0)) throw new ProtocolError("string contains NUL");
    let value: string;
    try {
      value = decoder.decode(bytes);
    } catch {
      throw new ProtocolError("string is not valid UTF-8");
    }
    if (objectPath && !isObjectPath(value)) throw new ProtocolError(`"${value}" is not a valid object path`);
    this.pos += length + 1;
    return value;
  }

  private array(type: DBusType & { kind: "array" | "dict" }): unknown {
    const size = this.u32();
    if (size > MAX_ARRAY_BYTES) throw new ProtocolError("array is longer than the specification allows");
    this.align(elementAlign(type));
    this.need(size);
    const arrayEnd = this.pos + size;
    if (type.kind === "array" && type.element.kind === "basic" && type.element.code === "y") {
      const bytes = this.data.slice(this.pos, arrayEnd);
      this.pos = arrayEnd;
      return bytes;
    }
    const outerEnd = this.end;
    this.end = arrayEnd;
    let result: unknown[] | Map<unknown, unknown>;
    if (type.kind === "dict") {
      const entries = new Map<unknown, unknown>();
      while (this.pos < arrayEnd) {
        this.align(8);
        const key = this.basic(type.key.code);
        entries.set(key, this.value(type.value));
      }
      result = entries;
    } else {
      const items: unknown[] = [];
      while (this.pos < arrayEnd) items.push(this.value(type.element));
      result = items;
    }
    this.end = outerEnd;
    if (this.pos !== arrayEnd) throw new ProtocolError("array elements overrun the array");
    return result;
  }

  value(type: DBusType): unknown {
    if (type.kind === "basic") return this.basic(type.code);
    if (++this.depth > MAX_DEPTH) throw new ProtocolError("values nest too deep");
    try {
      switch (type.kind) {
        case "variant": {
          const signature = this.string(this.u8(), false);
          return new Variant(signature, this.value(parseSingle(signature)));
        }
        case "array":
        case "dict":
          return this.array(type);
        case "struct": {
          this.align(alignOf(type));
          return type.fields.map((field) => this.value(field));
        }
      }
    } finally {
      this.depth--;
    }
  }
}

/** Read the values `signature` lists from `data`, which must be consumed exactly. */
export function unmarshal(signature: string, data: Uint8Array, little = true): unknown[] {
  const reader = new Reader(data, little);
  const values = parseSignature(signature).map((type) => reader.value(type));
  if (reader.remaining !== 0) throw new ProtocolError("message body has bytes after its last value");
  return values;
}
