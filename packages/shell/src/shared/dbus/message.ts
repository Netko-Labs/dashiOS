/**
 * Messages on the wire: the 16-byte fixed header, the header-field array
 * `a(yv)`, then the body. `frameLength` and `decodeMessage` take bytes from a
 * peer and validate everything the specification requires of them (version,
 * sizes, which fields each message type needs, name grammars, a body that
 * matches its signature); `encodeMessage` builds ours.
 */

import { ProtocolError } from "./errors.ts";
import { MAX_MESSAGE, marshal, Writer } from "./marshal.ts";
import { isBusName, isErrorName, isInterfaceName, isMemberName, isObjectPath } from "./names.ts";
import { parseSingle } from "./signature.ts";
import { Reader, unmarshal } from "./unmarshal.ts";
import { Variant } from "./variant.ts";

export const MessageType = { MethodCall: 1, MethodReturn: 2, Error: 3, Signal: 4 } as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const Flags = { NoReplyExpected: 0x1, NoAutoStart: 0x2, AllowInteractiveAuthorization: 0x4 } as const;

export interface Message {
  type: MessageType;
  flags: number;
  serial: number;
  path?: string;
  interface?: string;
  member?: string;
  errorName?: string;
  replySerial?: number;
  destination?: string;
  sender?: string;
  /** How many file descriptors travel with the message (`h` values index them); only `FdConnection` carries any. */
  unixFds?: number;
  /** The body's signature; empty when there is no body. */
  signature: string;
  body: unknown[];
}

const FIXED = 16;
/** Header fields are a few names and a path; anything near this is an attack. */
const MAX_FIELDS = 1 << 16;

const Field = {
  Path: 1,
  Interface: 2,
  Member: 3,
  ErrorName: 4,
  ReplySerial: 5,
  Destination: 6,
  Sender: 7,
  Signature: 8,
  UnixFds: 9,
} as const;
type Field = (typeof Field)[keyof typeof Field];

/** What each header field must carry: the variant's signature. */
const FIELD_TYPES: Readonly<Record<number, string>> = {
  [Field.Path]: "o",
  [Field.Interface]: "s",
  [Field.Member]: "s",
  [Field.ErrorName]: "s",
  [Field.ReplySerial]: "u",
  [Field.Destination]: "s",
  [Field.Sender]: "s",
  [Field.Signature]: "g",
  [Field.UnixFds]: "u",
};

const pad8 = (n: number): number => (n + 7) & ~7;

/**
 * The total byte length of the message whose fixed header is in `head` (at
 * least 16 bytes), checked against `limit`.
 */
export function frameLength(head: Uint8Array, limit = MAX_MESSAGE): number {
  if (head.length < FIXED) throw new ProtocolError("header is truncated");
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const marker = view.getUint8(0);
  if (marker !== 0x6c && marker !== 0x42) throw new ProtocolError("message does not start with an endianness marker");
  const little = marker === 0x6c;
  if (view.getUint8(3) !== 1) throw new ProtocolError(`unsupported protocol version ${view.getUint8(3)}`);
  const bodyLength = view.getUint32(4, little);
  const fieldsLength = view.getUint32(12, little);
  if (fieldsLength > MAX_FIELDS) throw new ProtocolError("header fields are too long");
  const total = pad8(FIXED + fieldsLength) + bodyLength;
  if (total > limit) throw new ProtocolError(`message of ${total} bytes exceeds the limit of ${limit}`);
  return total;
}

type Fields = Partial<Record<number, unknown>>;

const FIELDS_TYPE = parseSingle("a(yv)");

/** The `a(yv)` the reader decoded, as (code, variant) pairs. */
function fieldEntries(value: unknown): Array<[number, Variant]> {
  if (!Array.isArray(value)) throw new ProtocolError("header fields are not a list");
  return value.map((entry): [number, Variant] => {
    const [code, held] = Array.isArray(entry) ? entry : [];
    if (typeof code !== "number" || !(held instanceof Variant)) throw new ProtocolError("a header field is not a (byte, variant)");
    return [code, held];
  });
}

function readFields(reader: Reader): Fields {
  const entries = fieldEntries(reader.value(FIELDS_TYPE));
  const fields: Fields = {};
  for (const [code, held] of entries) {
    const expected = FIELD_TYPES[code];
    // Unknown fields are skipped, as the specification asks.
    if (expected === undefined) continue;
    if (code in fields) throw new ProtocolError(`header field ${code} appears twice`);
    if (held.signature !== expected) throw new ProtocolError(`header field ${code} has the wrong type`);
    fields[code] = held.value;
  }
  return fields;
}

/** A header field that the variant's signature has already made text (`o`, `s`, `g`). */
const stringField = (fields: Fields, code: Field): string | undefined => {
  const value = fields[code];
  if (value !== undefined && typeof value !== "string") throw new ProtocolError(`header field ${code} is not text`);
  return value;
};

/** A header field that the variant's signature has already made a number (`u`). */
const numberField = (fields: Fields, code: Field): number | undefined => {
  const value = fields[code];
  if (value !== undefined && typeof value !== "number") throw new ProtocolError(`header field ${code} is not a number`);
  return value;
};

const text = (fields: Fields, code: Field, valid: (value: string) => boolean, what: string): string | undefined => {
  const value = stringField(fields, code);
  if (value !== undefined && !valid(value)) throw new ProtocolError(`${what} "${value}" is not valid`);
  return value;
};

/** Decode one complete frame, as delimited by `frameLength`. */
export function decodeMessage(frame: Uint8Array): Message {
  const total = frameLength(frame, frame.length);
  if (total !== frame.length) throw new ProtocolError("frame length does not match its header");
  const little = frame[0] === 0x6c;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const type = view.getUint8(1);
  if (type < MessageType.MethodCall || type > MessageType.Signal) {
    throw new ProtocolError(`unknown message type ${type}`);
  }
  const serial = view.getUint32(8, little);
  if (serial === 0) throw new ProtocolError("message serial is zero");
  const reader = new Reader(frame, little, 12);
  const fields = readFields(reader);
  reader.align(8);

  const message: Message = { type: type as MessageType, flags: view.getUint8(2), serial, signature: "", body: [] };
  const path = text(fields, Field.Path, isObjectPath, "object path");
  const iface = text(fields, Field.Interface, isInterfaceName, "interface");
  const member = text(fields, Field.Member, isMemberName, "member");
  const errorName = text(fields, Field.ErrorName, isErrorName, "error name");
  const destination = text(fields, Field.Destination, isBusName, "destination");
  const sender = text(fields, Field.Sender, isBusName, "sender");
  if (path !== undefined) message.path = path;
  if (iface !== undefined) message.interface = iface;
  if (member !== undefined) message.member = member;
  if (errorName !== undefined) message.errorName = errorName;
  if (destination !== undefined) message.destination = destination;
  if (sender !== undefined) message.sender = sender;
  const replySerial = numberField(fields, Field.ReplySerial);
  if (replySerial !== undefined) message.replySerial = replySerial;
  message.signature = stringField(fields, Field.Signature) ?? "";
  const unixFds = numberField(fields, Field.UnixFds);
  if (unixFds !== undefined) message.unixFds = unixFds;

  const required =
    type === MessageType.MethodCall
      ? path !== undefined && member !== undefined
      : type === MessageType.Signal
        ? path !== undefined && iface !== undefined && member !== undefined
        : type === MessageType.MethodReturn
          ? message.replySerial !== undefined
          : errorName !== undefined && message.replySerial !== undefined;
  if (!required) throw new ProtocolError("message lacks a header field its type requires");

  const bodyLength = view.getUint32(4, little);
  message.body = unmarshal(message.signature, frame.subarray(frame.length - bodyLength), little);
  return message;
}

function field(code: Field, signature: string, value: unknown): [number, Variant] {
  return [code, new Variant(signature, value)];
}

/** The bytes of `message`; its `serial` must already be set. */
export function encodeMessage(message: Message): Uint8Array {
  if (message.serial === 0) throw new TypeError("message serial must not be zero");
  const body = marshal(message.signature, message.body).finish();
  const fields: Array<[number, Variant]> = [];
  if (message.path !== undefined) fields.push(field(Field.Path, "o", message.path));
  if (message.interface !== undefined) fields.push(field(Field.Interface, "s", message.interface));
  if (message.member !== undefined) fields.push(field(Field.Member, "s", message.member));
  if (message.errorName !== undefined) fields.push(field(Field.ErrorName, "s", message.errorName));
  if (message.replySerial !== undefined) fields.push(field(Field.ReplySerial, "u", message.replySerial));
  if (message.destination !== undefined) fields.push(field(Field.Destination, "s", message.destination));
  if (message.sender !== undefined) fields.push(field(Field.Sender, "s", message.sender));
  if (message.signature !== "") fields.push(field(Field.Signature, "g", message.signature));
  if (message.unixFds) fields.push(field(Field.UnixFds, "u", message.unixFds));

  const out = new Writer();
  out.u8(0x6c);
  out.u8(message.type);
  out.u8(message.flags);
  out.u8(1);
  out.u32(body.length);
  out.u32(message.serial);
  marshal("a(yv)", [fields], out);
  out.align(8);
  out.raw(body);
  return out.finish();
}

/**
 * Bytes as they arrive from the socket, cut into whole frames. A frame is
 * only handed out once all of it is here, and a header announcing more than
 * `limit` bytes fails at once, before anything is buffered for it.
 */
export class FrameBuffer {
  private bytes = new Uint8Array(4096);
  private start = 0;
  private end = 0;

  constructor(private readonly limit = MAX_MESSAGE) {}

  push(chunk: Uint8Array): void {
    if (this.end + chunk.length > this.bytes.length) {
      const used = this.end - this.start;
      if (used + chunk.length <= this.bytes.length) {
        this.bytes.copyWithin(0, this.start, this.end);
      } else {
        const grown = new Uint8Array(Math.max(used + chunk.length, this.bytes.length * 2));
        grown.set(this.bytes.subarray(this.start, this.end));
        this.bytes = grown;
      }
      this.start = 0;
      this.end = used;
    }
    this.bytes.set(chunk, this.end);
    this.end += chunk.length;
  }

  /** The next whole frame (a copy), or null while more bytes are needed. */
  next(): Uint8Array | null {
    if (this.end - this.start < FIXED) return null;
    const total = frameLength(this.bytes.subarray(this.start, this.start + FIXED), this.limit);
    if (this.end - this.start < total) return null;
    const frame = this.bytes.slice(this.start, this.start + total);
    this.start += total;
    if (this.start === this.end) this.start = this.end = 0;
    return frame;
  }

  /** Bytes buffered but not yet part of a returned frame. */
  take(): Uint8Array {
    const rest = this.bytes.slice(this.start, this.end);
    this.start = this.end = 0;
    return rest;
  }
}
