/**
 * IPP, the protocol CUPS speaks (RFC 8010, 8011): a request is a version, an
 * operation, a request id, groups of attributes and then the document; a
 * response is the same with a status in place of the operation. Dashi has no
 * IPP client of its own before this (Settings has no printers pane yet), so
 * this is a small one: what printing a PDF and listing printers need.
 * Responses are untrusted and parsed strictly; anything malformed is an error.
 */

export const Tag = {
  operation: 0x01,
  job: 0x02,
  end: 0x03,
  printer: 0x04,
  unsupported: 0x05,
} as const;

export const ValueTag = {
  integer: 0x21,
  boolean: 0x22,
  enum: 0x23,
  octetString: 0x30,
  dateTime: 0x31,
  resolution: 0x32,
  rangeOfInteger: 0x33,
  begCollection: 0x34,
  textWithLanguage: 0x35,
  nameWithLanguage: 0x36,
  endCollection: 0x37,
  text: 0x41,
  name: 0x42,
  keyword: 0x44,
  uri: 0x45,
  uriScheme: 0x46,
  charset: 0x47,
  naturalLanguage: 0x48,
  mimeMediaType: 0x49,
  memberAttrName: 0x4a,
} as const;

export const Operation = {
  printJob: 0x0002,
  getPrinterAttributes: 0x000b,
  cupsGetDefault: 0x4001,
  cupsGetPrinters: 0x4002,
} as const;

export type IppValue = number | boolean | string | [number, number];

export interface IppAttribute {
  name: string;
  tag: number;
  values: IppValue[];
}

export interface IppGroup {
  tag: number;
  attributes: IppAttribute[];
}

export interface IppResponse {
  status: number;
  requestId: number;
  groups: IppGroup[];
}

const encoder = new TextEncoder();

/** One attribute for a request: a name, a value tag, one or more values. */
export const attr = (name: string, tag: number, ...values: IppValue[]): IppAttribute => ({ name, tag, values });

function encodeValue(tag: number, value: IppValue): Uint8Array {
  if (tag === ValueTag.integer || tag === ValueTag.enum) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, Number(value));
    return out;
  }
  if (tag === ValueTag.boolean) return new Uint8Array([value === true ? 1 : 0]);
  if (tag === ValueTag.rangeOfInteger) {
    const [low, high] = Array.isArray(value) ? value : [Number(value), Number(value)];
    const out = new Uint8Array(8);
    const view = new DataView(out.buffer);
    view.setInt32(0, low);
    view.setInt32(4, high);
    return out;
  }
  return encoder.encode(String(value));
}

/** A whole request: header, groups, end tag, then the document's bytes. */
export function encodeRequest(operation: number, requestId: number, groups: readonly IppGroup[], document?: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  const header = new Uint8Array(8);
  const view = new DataView(header.buffer);
  view.setUint8(0, 2);
  view.setUint8(1, 0);
  view.setUint16(2, operation);
  view.setUint32(4, requestId);
  parts.push(header);
  for (const group of groups) {
    parts.push(new Uint8Array([group.tag]));
    for (const attribute of group.attributes) {
      attribute.values.forEach((value, index) => {
        const name = index === 0 ? encoder.encode(attribute.name) : new Uint8Array(0);
        const body = encodeValue(attribute.tag, value);
        const head = new Uint8Array(3 + name.length + 2);
        const v = new DataView(head.buffer);
        v.setUint8(0, attribute.tag);
        v.setUint16(1, name.length);
        head.set(name, 3);
        v.setUint16(3 + name.length, body.length);
        parts.push(head, body);
      });
    }
  }
  parts.push(new Uint8Array([Tag.end]));
  if (document) parts.push(document);
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function decodeValue(tag: number, bytes: Uint8Array): IppValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag === ValueTag.integer || tag === ValueTag.enum) {
    if (bytes.length !== 4) throw new Error("an IPP integer is not four bytes");
    return view.getInt32(0);
  }
  if (tag === ValueTag.boolean) {
    if (bytes.length !== 1) throw new Error("an IPP boolean is not one byte");
    return bytes[0] === 1;
  }
  if (tag === ValueTag.rangeOfInteger) {
    if (bytes.length !== 8) throw new Error("an IPP range is not eight bytes");
    return [view.getInt32(0), view.getInt32(4)];
  }
  if (tag === ValueTag.resolution || tag === ValueTag.dateTime || tag === ValueTag.octetString) return "";
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** A response, strictly; collections are read past (nothing here needs one). */
export function decodeResponse(data: Uint8Array): IppResponse {
  if (data.length < 9) throw new Error("the IPP response is too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const status = view.getUint16(2);
  const requestId = view.getUint32(4);
  const groups: IppGroup[] = [];
  let at = 8;
  let group: IppGroup | null = null;
  let last: IppAttribute | null = null;
  let depth = 0;
  for (;;) {
    if (at >= data.length) throw new Error("the IPP response ends without its end tag");
    const tag = data[at] as number;
    if (tag === Tag.end) break;
    if (tag < 0x10) {
      group = { tag, attributes: [] };
      groups.push(group);
      last = null;
      at += 1;
      continue;
    }
    if (at + 3 > data.length) throw new Error("the IPP response is cut short");
    const nameLength = view.getUint16(at + 1);
    const nameEnd = at + 3 + nameLength;
    if (nameEnd + 2 > data.length) throw new Error("the IPP response is cut short");
    const name = new TextDecoder().decode(data.subarray(at + 3, nameEnd));
    const valueLength = view.getUint16(nameEnd);
    const valueEnd = nameEnd + 2 + valueLength;
    if (valueEnd > data.length) throw new Error("the IPP response is cut short");
    const bytes = data.subarray(nameEnd + 2, valueEnd);
    at = valueEnd;
    if (!group) throw new Error("an IPP attribute comes before any group");
    if (tag === ValueTag.begCollection) {
      // A collection is kept as an empty value; its members are read past.
      if (depth === 0 && nameLength > 0) {
        last = { name, tag, values: [""] };
        group.attributes.push(last);
      } else if (depth === 0) {
        last?.values.push("");
      }
      depth++;
      continue;
    }
    if (tag === ValueTag.endCollection) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    // Out-of-band tags (unknown, no-value) carry no value.
    const value = tag < 0x20 ? undefined : decodeValue(tag, bytes);
    if (nameLength === 0) {
      if (value !== undefined) last?.values.push(value);
    } else {
      last = { name, tag, values: value === undefined ? [] : [value] };
      group.attributes.push(last);
    }
  }
  return { status, requestId, groups };
}

/** Whether a response's status is one of the successful ones (0x0000–0x00ff). */
export const succeeded = (response: IppResponse): boolean => response.status < 0x100;

/** The first value of `name` in a group. */
export function valueOf(group: IppGroup, name: string): IppValue | undefined {
  return group.attributes.find((attribute) => attribute.name === name)?.values[0];
}

export function valuesOf(group: IppGroup, name: string): IppValue[] {
  return group.attributes.find((attribute) => attribute.name === name)?.values ?? [];
}
