/**
 * BlueZ's names on the system bus and a thin client over one connection:
 * calls to its objects, and properties read the way the bus delivers them.
 * Nothing here knows about device lists or pairing.
 */

import { type DBusConnection, unwrap, Variant } from "../../shared/dbus/index.ts";

export const BLUEZ = "org.bluez";
export const BLUEZ_ROOT = "/org/bluez";
export const AGENT_MANAGER = "org.bluez.AgentManager1";
export const OBJECT_MANAGER = "org.freedesktop.DBus.ObjectManager";
export const PROPERTIES = "org.freedesktop.DBus.Properties";

export class BluezClient {
  constructor(readonly connection: DBusConnection) {}

  call(path: string, iface: string, member: string, signature?: string, body?: readonly unknown[], timeoutMs?: number): Promise<unknown[]> {
    return this.connection.call(
      { destination: BLUEZ, path, interface: iface, member, ...(signature === undefined ? {} : { signature, body: body ?? [] }) },
      timeoutMs,
    );
  }

  /** The reply of `GetManagedObjects`: every adapter and device, with all their properties. */
  async managedObjects(): Promise<unknown> {
    const [reply] = await this.call("/", OBJECT_MANAGER, "GetManagedObjects");
    return reply;
  }

  async property(path: string, iface: string, name: string, timeoutMs?: number): Promise<unknown> {
    const [reply] = await this.call(path, PROPERTIES, "Get", "ss", [iface, name], timeoutMs);
    return unwrap(reply);
  }

  /** Sets a property; `signature` is its type (`b` for a boolean). */
  async setProperty(path: string, iface: string, name: string, signature: string, value: unknown): Promise<void> {
    await this.call(path, PROPERTIES, "Set", "ssv", [iface, name, new Variant(signature, value)]);
  }
}
