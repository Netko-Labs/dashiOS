/**
 * `dashi://` addresses (docs/actions.md): one per action, a path of
 * segments after the scheme, with arguments as a query.
 *
 *   dashi://settings/appearance/dark-mode
 *   dashi://settings/appearance/dark-mode?value=true
 *   dashi://app/dev.dashi.notes/menu/new
 *   dashi://window/w3
 *
 * A segment is letters, digits, and `. _ : -` (app ids and menu item ids
 * are); anything else is refused, never guessed at. Query values arrive as
 * text and are read by the action's own schema (`argsFromQuery`): "true" is
 * a boolean only where the schema says boolean.
 */

import { isRecord } from "@dashi/shape";
import type { Args } from "./types.ts";

export const SCHEME = "dashi://";
/** Longer than any address Dashi writes; a longer link is refused. */
export const MAX_ADDRESS = 2048;
const SEGMENT = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_SEGMENTS = 8;
const MAX_ARGS = 16;

export interface ParsedAddress {
  /** The canonical address without arguments: what the registry is keyed by. */
  address: string;
  segments: readonly string[];
  /** The query, as text. */
  query: Readonly<Record<string, string>>;
}

export const isSegment = (value: string): boolean => SEGMENT.test(value) && value !== "." && value !== "..";

/** `["settings", "appearance", "dark-mode"]` to `dashi://settings/appearance/dark-mode`; throws on a segment that can't be one (a bug in a source). */
export function formatAddress(segments: readonly string[]): string {
  const bad = segments.find((segment) => !isSegment(segment));
  if (bad !== undefined || segments.length === 0 || segments.length > MAX_SEGMENTS) throw new Error(`not an address: ${JSON.stringify(segments)}`);
  return `${SCHEME}${segments.join("/")}`;
}

/** A word as an address segment: "New Note" → "new-note"; null when nothing of it is left. */
export function slug(text: string): string | null {
  const word = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return word === "" ? null : word;
}

/** A link or a typed address, checked; null when it is not a `dashi://` address. */
export function parseAddress(text: string): ParsedAddress | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_ADDRESS || trimmed.slice(0, SCHEME.length).toLowerCase() !== SCHEME) return null;
  const rest = trimmed.slice(SCHEME.length).split("#")[0] ?? "";
  const mark = rest.indexOf("?");
  const path = mark < 0 ? rest : rest.slice(0, mark);
  const search = mark < 0 ? "" : rest.slice(mark + 1);
  let segments: string[];
  try {
    segments = path
      .replace(/\/+$/, "")
      .split("/")
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (segments.length === 0 || segments.length > MAX_SEGMENTS || !segments.every(isSegment)) return null;
  // No prototype: `constructor` or `__proto__` in a link is a key like any other.
  const query: Record<string, string> = Object.create(null);
  const params = new URLSearchParams(search);
  let count = 0;
  for (const [key, value] of params) {
    if (++count > MAX_ARGS || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || Object.hasOwn(query, key)) return null;
    query[key] = value;
  }
  // The scheme's "host" is the first segment; it is matched without case, the rest exactly (app ids have capitals).
  const [first, ...others] = segments as [string, ...string[]];
  const canonical = [first.toLowerCase(), ...others];
  return { address: `${SCHEME}${canonical.join("/")}`, segments: canonical, query };
}

/** The type a property's schema gives, or the types of a `oneOf`. */
function typesOf(schema: unknown): string[] {
  if (!isRecord(schema)) return [];
  const record = schema;
  if (typeof record.type === "string") return [record.type];
  if (Array.isArray(record.oneOf)) return record.oneOf.flatMap(typesOf);
  return [];
}

/** One query value read by its schema: a boolean, a number, an object or list (JSON), or the text itself. */
function readValue(text: string, schema: unknown): unknown {
  const types = typesOf(schema);
  if (types.includes("boolean") && (text === "true" || text === "false")) return text === "true";
  if ((types.includes("number") || types.includes("integer")) && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if ((types.includes("object") || types.includes("array")) && /^[[{]/.test(text)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

/** A query as an action's arguments, each value read by that argument's schema; names it doesn't take stay, for `check` to refuse. */
export function argsFromQuery(query: Readonly<Record<string, string>>, properties: Record<string, unknown>): Args {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, readValue(value, properties[key])]));
}

/** `address` with `args` as its query (what Copy Address gives for an action with its arguments filled in). */
export function withArgs(address: string, args: Args): string {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) return address;
  const params = new URLSearchParams(entries.map(([key, value]): [string, string] => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]));
  return `${address}?${params.toString()}`;
}
