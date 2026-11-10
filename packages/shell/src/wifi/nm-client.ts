/**
 * NetworkManager's names on the system bus and a thin client over one
 * connection: calls to its objects, and properties read the way the bus
 * delivers them. Nothing here knows about Wi-Fi lists or joining.
 */

import type { DBusConnection } from "../shared/dbus/index.ts";
import { propertyMap, unwrap } from "./nm-values.ts";

export const NM = "org.freedesktop.NetworkManager";
export const NM_PATH = "/org/freedesktop/NetworkManager";
export const SETTINGS_PATH = `${NM_PATH}/Settings`;
export const IFACE = {
  manager: NM,
  device: `${NM}.Device`,
  wireless: `${NM}.Device.Wireless`,
  accessPoint: `${NM}.AccessPoint`,
  settings: `${NM}.Settings`,
  profile: `${NM}.Settings.Connection`,
  active: `${NM}.Connection.Active`,
} as const;
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** NMDeviceType: a Wi-Fi radio (not Wi-Fi P2P, which is 30). */
export const DEVICE_TYPE_WIFI = 2;

export class NmClient {
  constructor(readonly connection: DBusConnection) {}

  call(path: string, iface: string, member: string, signature?: string, body?: readonly unknown[]): Promise<unknown[]> {
    return this.connection.call({ destination: NM, path, interface: iface, member, ...(signature === undefined ? {} : { signature, body: body ?? [] }) });
  }

  /** All of an interface's properties, unwrapped; rejects if the reply is not a property dictionary. */
  async properties(path: string, iface: string): Promise<Map<string, unknown>> {
    const [reply] = await this.call(path, PROPERTIES, "GetAll", "s", [iface]);
    const properties = propertyMap(reply);
    if (!properties) throw new TypeError(`${iface} did not answer with properties`);
    return properties;
  }

  async property(path: string, iface: string, name: string): Promise<unknown> {
    const [reply] = await this.call(path, PROPERTIES, "Get", "ss", [iface, name]);
    return unwrap(reply);
  }

  /** A reply that should be a list of object paths; anything else is an empty list. */
  async paths(path: string, iface: string, member: string): Promise<string[]> {
    const [reply] = await this.call(path, iface, member);
    return Array.isArray(reply) && reply.every((item) => typeof item === "string") ? (reply as string[]) : [];
  }

  /** The Wi-Fi device to scan and join with: the first that is managed, else the first. */
  async wifiDevice(): Promise<string | null> {
    const devices = await this.paths(NM_PATH, IFACE.manager, "GetDevices");
    const found = await Promise.allSettled(devices.map(async (path) => ({ path, properties: await this.properties(path, IFACE.device) })));
    const wifi = found.flatMap((result) =>
      result.status === "fulfilled" && result.value.properties.get("DeviceType") === DEVICE_TYPE_WIFI ? [result.value] : [],
    );
    // NMDeviceState 10 is unmanaged: NetworkManager is told to leave it alone.
    return (wifi.find((device) => device.properties.get("State") !== 10) ?? wifi[0])?.path ?? null;
  }
}
