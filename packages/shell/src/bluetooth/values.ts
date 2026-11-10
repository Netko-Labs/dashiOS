/**
 * BlueZ's D-Bus values, read strictly: what comes back from the system bus
 * is untrusted until each field has the type it should, and a device (or
 * adapter) that does not is skipped rather than guessed at. Names come from
 * the devices themselves, so they are cleaned before anything draws them.
 */

import { propertyMap } from "../shared/dbus/properties.ts";
import { cleanText } from "../shared/io/text.ts";
import type { AdapterReading, BluetoothReading, DeviceKind, RawDevice } from "./types.ts";

export const ADAPTER_PATH = /^\/org\/bluez\/hci(\d{1,3})$/;
export const DEVICE_PATH = /^\/org\/bluez\/hci\d{1,3}\/dev_[0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5}$/;
const ADDRESS = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/;

/** A name is at most 248 bytes on the air; this keeps a hostile one from filling the list. */
const MAX_NAME = 128;

export const IFACE = {
  adapter: "org.bluez.Adapter1",
  device: "org.bluez.Device1",
  battery: "org.bluez.Battery1",
} as const;

/** A device name made fit to draw; empty when nothing is left. */
export function cleanName(text: string): string {
  const clean = cleanText(text);
  return clean.length > MAX_NAME ? `${[...clean].slice(0, MAX_NAME).join("")}…` : clean;
}

/** A PIN BlueZ will accept: 1 to 16 printable ASCII characters. */
export const isPin = (value: string): boolean => /^[\x20-\x7e]{1,16}$/.test(value);

/** The adapter a device path belongs to. */
export const adapterOf = (devicePath: string): string => devicePath.slice(0, devicePath.lastIndexOf("/"));

/** The freedesktop icon name BlueZ derives from the device class or appearance, as a kind of device. */
export function kindOf(icon: string | null): DeviceKind {
  switch (icon) {
    case "audio-headset":
    case "audio-headphones":
      return "headphones";
    case "audio-card":
    case "audio-speakers":
      return "speaker";
    case "input-mouse":
      return "mouse";
    case "input-keyboard":
      return "keyboard";
    case "phone":
      return "phone";
    default:
      return "generic";
  }
}

/** A property that may be absent but, when there, has to be this type. `undefined` means wrong type. */
function optional<T>(properties: ReadonlyMap<string, unknown>, name: string, is: (value: unknown) => value is T): T | null | undefined {
  const value = properties.get(name);
  if (value === undefined) return null;
  return is(value) ? value : undefined;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** The adapter at `path` from its `org.bluez.Adapter1` properties. */
export function parseAdapter(path: string, properties: ReadonlyMap<string, unknown>): AdapterReading | null {
  if (!ADAPTER_PATH.test(path)) return null;
  const powered = properties.get("Powered");
  const discovering = optional(properties, "Discovering", isBoolean);
  if (typeof powered !== "boolean" || discovering === undefined) return null;
  return { path, powered, discovering: discovering ?? false };
}

/** `Percentage` from `org.bluez.Battery1`: a byte from 0 to 100; anything else is no reading. */
export function parseBattery(properties: ReadonlyMap<string, unknown> | undefined): number | null {
  const percentage = properties?.get("Percentage");
  return typeof percentage === "number" && Number.isInteger(percentage) && percentage >= 0 && percentage <= 100 ? percentage : null;
}

/** The device at `path` from its `org.bluez.Device1` properties and, if it has one, its battery's. */
export function parseDevice(path: string, properties: ReadonlyMap<string, unknown>, battery?: ReadonlyMap<string, unknown>): RawDevice | null {
  if (!DEVICE_PATH.test(path)) return null;
  const address = properties.get("Address");
  const paired = properties.get("Paired");
  const connected = properties.get("Connected");
  const adapter = properties.get("Adapter");
  const name = optional(properties, "Name", isString);
  const alias = optional(properties, "Alias", isString);
  const icon = optional(properties, "Icon", isString);
  const rssi = properties.get("RSSI");
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  if (typeof paired !== "boolean" || typeof connected !== "boolean") return null;
  if (adapter !== adapterOf(path)) return null;
  if (name === undefined || alias === undefined || icon === undefined) return null;
  if (rssi !== undefined && (typeof rssi !== "number" || !Number.isInteger(rssi))) return null;
  return {
    path,
    address: address.toUpperCase(),
    name: name === null ? null : cleanName(name) || null,
    alias: alias === null ? null : cleanName(alias) || null,
    kind: kindOf(icon),
    paired,
    connected,
    // BlueZ reports -127 to 20; the ends are "unknown", not a signal.
    rssi: rssi === undefined || rssi < -126 || rssi > 20 ? null : rssi,
    battery: parseBattery(battery),
  };
}

/** The adapters in a `GetManagedObjects` reply, nearest the first, and every device with its interfaces. */
export function parseManagedObjects(reply: unknown): BluetoothReading {
  if (!(reply instanceof Map)) throw new TypeError("GetManagedObjects did not answer with objects");
  const adapters: AdapterReading[] = [];
  const devices: Array<{ device: Map<string, unknown>; battery?: Map<string, unknown>; path: string }> = [];
  for (const [path, interfaces] of reply) {
    if (typeof path !== "string" || !(interfaces instanceof Map)) continue;
    const read = new Map<string, Map<string, unknown>>();
    for (const [name, properties] of interfaces) {
      const map = typeof name === "string" ? propertyMap(properties) : null;
      if (map) read.set(name as string, map);
    }
    const adapterProperties = read.get(IFACE.adapter);
    if (adapterProperties) {
      const adapter = parseAdapter(path, adapterProperties);
      if (adapter) adapters.push(adapter);
    }
    const device = read.get(IFACE.device);
    const battery = read.get(IFACE.battery);
    if (device) devices.push({ path, device, ...(battery ? { battery } : {}) });
  }
  // The first adapter is the machine's: hci0, then hci1 (numerically, so hci10 is after hci2).
  adapters.sort((a, b) => Number(ADAPTER_PATH.exec(a.path)?.[1]) - Number(ADAPTER_PATH.exec(b.path)?.[1]));
  const adapter = adapters[0];
  if (!adapter) return { kind: "unavailable" };
  const mine = devices.flatMap(({ path, device, battery }) => {
    const parsed = parseDevice(path, device, battery);
    return parsed && adapterOf(path) === adapter.path ? [parsed] : [];
  });
  return { kind: "ready", adapter, devices: mine };
}
