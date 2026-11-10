/**
 * Reading the `a{sv}` option dictionaries xdg-desktop-portal passes. Every
 * value is untrusted: a getter returns the value only when it has the type
 * the spec gives it (by the variant's signature, then by its JS shape), and
 * undefined otherwise, so a wrong type is the same as an option left out.
 */

import { Variant, variant } from "../../src/shared/dbus/index.ts";

export type Vardict = ReadonlyMap<string, Variant>;

const EMPTY: Vardict = new Map();
const MAX_TEXT = 4096;

/** The dictionary in a call's argument; anything that is not one is empty. */
export function vardict(value: unknown): Vardict {
  if (!(value instanceof Map)) return EMPTY;
  const out = new Map<string, Variant>();
  for (const [key, entry] of value) if (typeof key === "string" && entry instanceof Variant) out.set(key, entry);
  return out;
}

const typed = (dict: Vardict, key: string, signature: string): unknown => {
  const entry = dict.get(key);
  return entry?.signature === signature ? entry.value : undefined;
};

/** A string, without control characters other than newlines and tabs, and not absurdly long. */
export function cleanString(value: string, max = MAX_TEXT): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
}

export function str(dict: Vardict, key: string): string | undefined {
  const value = typed(dict, key, "s");
  return typeof value === "string" ? cleanString(value) : undefined;
}

export function bool(dict: Vardict, key: string): boolean | undefined {
  const value = typed(dict, key, "b");
  return typeof value === "boolean" ? value : undefined;
}

export function u32(dict: Vardict, key: string): number | undefined {
  const value = typed(dict, key, "u");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function strings(dict: Vardict, key: string): string[] | undefined {
  const value = typed(dict, key, "as");
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value.map((item) => cleanString(item as string)) : undefined;
}

/** An `ay` holding a NUL-terminated path (`current_folder`, `current_file`), decoded as UTF-8; undefined if it is not one. */
export function bytePath(dict: Vardict, key: string): string | undefined {
  const value = typed(dict, key, "ay");
  return value instanceof Uint8Array ? decodeBytePath(value) : undefined;
}

export function decodeBytePath(bytes: Uint8Array): string | undefined {
  const end = bytes.indexOf(0);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(end >= 0 ? bytes.subarray(0, end) : bytes);
  return text.startsWith("/") && !/[\u0000-\u001f]/.test(text) ? text : undefined;
}

/** A value of any signature, as it came (for options passed back unchanged, like an icon). */
export function raw(dict: Vardict, key: string): Variant | undefined {
  return dict.get(key);
}

/** Results for a response: plain values tagged with their signatures. */
export function results(entries: Record<string, [signature: string, value: unknown] | undefined>): Map<string, Variant> {
  const out = new Map<string, Variant>();
  for (const [key, entry] of Object.entries(entries)) if (entry) out.set(key, variant(entry[0], entry[1]));
  return out;
}

/** A path as the `ay` a portal wants (with the NUL). */
export function encodeBytePath(path: string): Uint8Array {
  const bytes = new TextEncoder().encode(path);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  return out;
}
