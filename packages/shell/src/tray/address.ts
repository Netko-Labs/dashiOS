/**
 * Where a tray item lives, and the watcher's list of them. An item is an
 * object on someone's connection: a bus name and an object path, written as
 * one id (`:1.42/StatusNotifierItem`, `org.kde.StatusNotifierItem-7-1/StatusNotifierItem`)
 * the way KDE's watcher lists them in RegisteredStatusNotifierItems. Nothing
 * here touches the bus, so the bookkeeping is tested on its own.
 */

import { isBusName, isObjectPath } from "../shared/dbus/index.ts";

/** Where an item that registers by bus name alone puts its object. */
export const DEFAULT_ITEM_PATH = "/StatusNotifierItem";

/** More items than any desktop shows; a client that keeps registering stops here. */
export const MAX_ITEMS = 128;

export interface ItemAddress {
  bus: string;
  path: string;
}

/** The id the watcher lists and signals: the bus name followed by the path. */
export const itemId = (address: ItemAddress): string => `${address.bus}${address.path}`;

/** The menu bar extra's key for an item (extras/types.ts). */
export const itemKey = (address: ItemAddress): string => `tray:${itemId(address)}`;

/**
 * An id as another watcher lists it: a bus name, optionally followed by the
 * object path. Null for anything that is not one.
 */
export function parseItemId(id: unknown): ItemAddress | null {
  if (typeof id !== "string") return null;
  const slash = id.indexOf("/");
  const bus = slash < 0 ? id : id.slice(0, slash);
  const path = slash < 0 ? DEFAULT_ITEM_PATH : id.slice(slash);
  return isBusName(bus) && isObjectPath(path) ? { bus, path } : null;
}

/**
 * The item a RegisterStatusNotifierItem call names. The argument is a bus name
 * (the item is at the default path), an object path (the item is on the
 * caller's connection: what libappindicator and Ayatana send), or a whole id.
 */
export function parseRegistration(arg: unknown, sender: string | undefined): ItemAddress | null {
  if (typeof arg !== "string") return null;
  if (arg.startsWith("/")) {
    return sender !== undefined && isBusName(sender) && isObjectPath(arg) ? { bus: sender, path: arg } : null;
  }
  return parseItemId(arg);
}

export type AddResult = "added" | "known" | "full";

/** The watcher's registered items, one per id. */
export class ItemRegistry {
  private readonly items = new Map<string, ItemAddress>();

  constructor(private readonly limit = MAX_ITEMS) {}

  add(address: ItemAddress): AddResult {
    const id = itemId(address);
    if (this.items.has(id)) return "known";
    if (this.items.size >= this.limit) return "full";
    this.items.set(id, address);
    return "added";
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  /** `name` left the bus: its items go, and are returned. */
  ownerGone(name: string): ItemAddress[] {
    const gone = [...this.items.values()].filter((address) => address.bus === name);
    for (const address of gone) this.items.delete(itemId(address));
    return gone;
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  get size(): number {
    return this.items.size;
  }
}

/** A NameOwnerChanged body read as the name that just lost its owner, or null if none did. */
export function nameGone(body: readonly unknown[]): string | null {
  const [name, previous, next] = body;
  if (typeof name !== "string" || typeof previous !== "string" || typeof next !== "string") return null;
  return previous !== "" && next === "" ? name : null;
}
