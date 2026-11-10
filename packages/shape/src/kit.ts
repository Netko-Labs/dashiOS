/**
 * The field-by-field kit (grown from @dashi/applet's parse.ts, which the app
 * menus' protocol copied): each reads one value and answers it or a
 * `Refusal` whose words name the field. Messages and manifests from other
 * processes use it where their refusals are part of a protocol; new code
 * writes a shape (shape.ts, compose.ts).
 */

import { isRecord, isRefusal, type Refusal, refuse } from "./refusal.ts";

export { isRefusal, type Refusal, refuse };

import { length } from "./shape.ts";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// Control characters, and the bidi overrides that could make a label read as another.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/u;

/** Characters (code points) of an id. */
export const ID_LIMIT = 64;

/** An object with only `allowed` keys. */
export function record(value: unknown, what: string, allowed: readonly string[]): Record<string, unknown> | Refusal {
  if (!isRecord(value)) return refuse(`${what} must be an object`);
  const stray = Object.keys(value).find((key) => !allowed.includes(key));
  return stray === undefined ? value : refuse(`${what} has an unknown field “${stray}”`);
}

/** Text a person reads: trimmed, not empty, at most `max` characters, no control characters. */
export function text(value: unknown, what: string, max: number): string | Refusal {
  if (typeof value !== "string") return refuse(`${what} must be a string`);
  const trimmed = value.trim();
  if (trimmed === "") return refuse(`${what} is empty`);
  if (length(trimmed) > max) return refuse(`${what} is longer than ${max} characters`);
  if (UNSAFE.test(trimmed)) return refuse(`${what} has control characters`);
  return trimmed;
}

export function optionalText(value: unknown, what: string, max: number): string | undefined | Refusal {
  return value === undefined ? undefined : text(value, what, max);
}

export function id(value: unknown, what: string, limit = ID_LIMIT): string | Refusal {
  if (typeof value !== "string" || !ID.test(value)) return refuse(`${what} must be letters, digits, and . _ : -, starting with a letter or digit`);
  return value.length > limit ? refuse(`${what} is longer than ${limit} characters`) : value;
}

export function optionalBoolean(value: unknown, what: string): boolean | undefined | Refusal {
  if (value === undefined || typeof value === "boolean") return value;
  return refuse(`${what} must be true or false`);
}

/** A whole number from `min` to `max`. */
export function integer(value: unknown, what: string, min: number, max: number): number | Refusal {
  if (typeof value !== "number" || !Number.isInteger(value)) return refuse(`${what} must be a whole number`);
  if (value < min || value > max) return refuse(`${what} must be from ${min} to ${max}`);
  return value;
}

/** A list of at most `max` entries, each parsed; the first refusal wins. */
export function list<T>(value: unknown, what: string, max: number, each: (entry: unknown, where: string) => T | Refusal): T[] | Refusal {
  if (!Array.isArray(value)) return refuse(`${what} must be a list`);
  if (value.length > max) return refuse(`${what} has more than ${max} entries`);
  const out: T[] = [];
  for (const [at, entry] of value.entries()) {
    const parsed = each(entry, `${what}, entry ${at + 1}`);
    if (isRefusal(parsed)) return parsed;
    out.push(parsed);
  }
  return out;
}

/** One line of JSON as an object with a string `type`. */
export function typedObject(line: string): { type: string; fields: Record<string, unknown> } | Refusal {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return refuse("not JSON");
  }
  if (!isRecord(value)) return refuse("the message must be an object");
  return typeof value.type === "string" ? { type: value.type, fields: value } : refuse("the message has no type");
}

/** A path inside a folder: relative, no `..`, no hidden parts. */
export function isInsidePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}
