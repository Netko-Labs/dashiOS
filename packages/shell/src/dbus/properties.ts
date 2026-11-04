/** Property dictionaries (`a{sv}`) as the services on the bus return them, unwrapped to plain values. */

import { Variant } from "./variant.ts";

/** A variant's value; anything else as it is. */
export const unwrap = (value: unknown): unknown => (value instanceof Variant ? value.value : value);

/** An `a{sv}` reply as a plain map from name to value; null if it is not one. */
export function propertyMap(reply: unknown): Map<string, unknown> | null {
  if (!(reply instanceof Map)) return null;
  const properties = new Map<string, unknown>();
  for (const [name, value] of reply) {
    if (typeof name !== "string") return null;
    properties.set(name, unwrap(value));
  }
  return properties;
}
