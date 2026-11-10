/** Property dictionaries (`a{sv}`) as the services on the bus return them, unwrapped to plain values. */

import type { Message } from "./message.ts";
import type { MatchRule } from "./signals.ts";
import type { CallSpec } from "./types.ts";
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

/** The standard properties interface. */
export const PROPERTIES = "org.freedesktop.DBus.Properties";

/** One object's interface: its service, its path, and the interface's name. */
export interface PropertyTarget {
  destination: string;
  path: string;
  interface: string;
}

/** The calls these helpers make (a `DBusConnection` has them; tests hand in a fake). */
export interface BusLike {
  call(spec: CallSpec): Promise<unknown[]>;
  subscribe(rule: MatchRule, handler: (message: Message) => void): Promise<() => Promise<void>>;
}

/** `GetAll` as a plain map; null when the reply is not a property dictionary. */
export async function getAllProperties(bus: BusLike, target: PropertyTarget): Promise<Map<string, unknown> | null> {
  const [reply] = await bus.call({
    destination: target.destination,
    path: target.path,
    interface: PROPERTIES,
    member: "GetAll",
    signature: "s",
    body: [target.interface],
  });
  return propertyMap(reply);
}

/** `Set` one property to `value`, a variant. */
export async function setProperty(bus: BusLike, target: PropertyTarget, name: string, value: Variant): Promise<void> {
  await bus.call({
    destination: target.destination,
    path: target.path,
    interface: PROPERTIES,
    member: "Set",
    signature: "ssv",
    body: [target.interface, name, value],
  });
}

/** `PropertiesChanged` for this object's interface: the changed values, unwrapped. */
export function onPropertiesChanged(bus: BusLike, target: PropertyTarget, handler: (changed: Map<string, unknown>) => void): Promise<() => Promise<void>> {
  return bus.subscribe({ type: "signal", sender: target.destination, interface: PROPERTIES, member: "PropertiesChanged", path: target.path }, (message) => {
    const [iface, changed] = message.body;
    if (iface !== target.interface) return;
    const map = propertyMap(changed);
    if (map) handler(map);
  });
}
