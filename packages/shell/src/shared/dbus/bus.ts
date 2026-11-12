/**
 * The bus daemon's own interface (`org.freedesktop.DBus`): owning names and
 * asking who owns them.
 */

import { list, str } from "@dashi/shape";
import type { DBusConnection } from "./connection.ts";
import { DBusError, ERRORS } from "./errors.ts";
import { value } from "./lib/reply.ts";

export const BUS_NAME = "org.freedesktop.DBus";
export const BUS_PATH = "/org/freedesktop/DBus";
const BUS = { destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME } as const;

export const NameFlags = {
  allowReplacement: 0x1,
  replaceExisting: 0x2,
  doNotQueue: 0x4,
} as const;

export type NameResult = "primary" | "queued" | "exists" | "already-owner";

const RESULTS: Readonly<Record<number, NameResult>> = { 1: "primary", 2: "queued", 3: "exists", 4: "already-owner" };

/** Ask for `name`. `flags` are `NameFlags` values or'd together. */
export async function requestName(connection: DBusConnection, name: string, flags = 0): Promise<NameResult> {
  const [code] = await connection.call({ ...BUS, member: "RequestName", signature: "su", body: [name, flags] });
  const result = typeof code === "number" ? RESULTS[code] : undefined;
  if (!result) throw new DBusError(ERRORS.failed, `RequestName answered with ${String(code)}`);
  return result;
}

export async function releaseName(connection: DBusConnection, name: string): Promise<void> {
  await connection.call({ ...BUS, member: "ReleaseName", signature: "s", body: [name] });
}

/** The unique name that owns `name`; rejects with `NameHasNoOwner` if nobody does. */
export async function getNameOwner(connection: DBusConnection, name: string): Promise<string> {
  return connection.read({ ...BUS, member: "GetNameOwner", signature: "s", body: [name] }, value(str()));
}

/** Whether anyone owns `name` right now; a unique name (`:1.42`) is owned while its connection lives. */
export async function nameHasOwner(connection: DBusConnection, name: string): Promise<boolean> {
  const [owned] = await connection.call({ ...BUS, member: "NameHasOwner", signature: "s", body: [name] });
  return owned === true;
}

export async function listNames(connection: DBusConnection): Promise<string[]> {
  return connection.read({ ...BUS, member: "ListNames" }, value(list(str())));
}
