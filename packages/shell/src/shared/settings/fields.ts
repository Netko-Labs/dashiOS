/**
 * Reading a section of the settings file: the object at its path, and only
 * the keys that hold a value of the right kind. System Settings' store
 * (settings-app/store.ts) reads every section this way; an app reads the few
 * it needs (region.ts).
 */

export type Raw = Record<string, unknown>;
export type Check = (value: unknown) => boolean;

export const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

export const isBoolean: Check = (value) => typeof value === "boolean";
export const numberIn =
  (min: number, max: number, whole = false): Check =>
  (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
export const oneOf =
  (...options: string[]): Check =>
  (value) =>
    typeof value === "string" && options.includes(value);

/** The object at `path` inside `root`, or undefined. */
export function dig(root: Raw, path: readonly string[]): Raw | undefined {
  let at: unknown = root;
  for (const key of path) {
    if (!isRaw(at)) return undefined;
    at = at[key];
  }
  return isRaw(at) ? at : undefined;
}

/** Only the keys of the section at `path` that hold a value of the right kind. */
export function readFields(raw: Raw, path: readonly string[], fields: Record<string, Check>): Raw {
  const found = dig(raw, path);
  const out: Raw = {};
  if (!found) return out;
  for (const [key, check] of Object.entries(fields)) {
    if (Object.hasOwn(found, key) && check(found[key])) out[key] = found[key];
  }
  return out;
}
