/**
 * Reading JSON from outside, strictly: every field is checked for its type
 * and cut to a length before the rest of Software sees it. A field of the
 * wrong kind is "absent", never coerced; a record that lacks what it must
 * have is dropped by its caller. URLs must be HTTPS on a host Software
 * downloads from.
 */

import { tidy } from "./text.ts";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The hosts Software downloads from: the API and the media (icons, screenshots). */
export const API_HOSTS: readonly string[] = ["flathub.org"];
export const MEDIA_HOSTS: readonly string[] = ["dl.flathub.org"];

/** `value` as an `https:` URL on one of `hosts` (no credentials, no port), else null. */
export function httpsUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") return null;
  return hosts.includes(url.hostname) ? url.href : null;
}

/** Any `https:` URL, for text shown to the person (a homepage); it is never fetched. */
export function displayUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url.href : null;
  } catch {
    return null;
  }
}

export function text(record: JsonRecord, key: string, max: number): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  const clean = tidy(value, max);
  return clean === "" ? null : clean;
}

export function count(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A number or a string of digits (AppStream timestamps are strings), as a whole number. */
export function whole(value: unknown): number | null {
  const number = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function flag(record: JsonRecord, key: string): boolean {
  return record[key] === true;
}

export function list(record: JsonRecord, key: string, max: number): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value.slice(0, max) : [];
}
