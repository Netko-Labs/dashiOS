/**
 * The StatusNotifierHost: every registered item followed (item.ts) and shown
 * in the extras store, and what the menu bar asks of a tray extra carried to
 * its item. Items arrive and leave through `ItemEvents`, from whichever
 * watcher the tray found (watcher.ts).
 */

import type { ExtraActions, ExtraMenuRow, ExtrasStore, MenuBarExtra } from "../../extras/index.ts";
import type { DBusConnection } from "../../shared/dbus/index.ts";
import { type ItemAddress, itemId, MAX_ITEMS } from "./address.ts";
import type { TrayIcons } from "./icon.ts";
import { TrayItem } from "./item.ts";
import type { ItemEvents } from "./watcher.ts";

export class TrayHost implements ExtraActions, ItemEvents {
  /** By extra key (`tray:` and the item id). */
  private readonly items = new Map<string, TrayItem>();

  constructor(
    private readonly connection: DBusConnection,
    private readonly extras: ExtrasStore,
    private readonly icons: TrayIcons,
  ) {}

  registered(address: ItemAddress): void {
    const known = [...this.items.values()].find((item) => itemId(item.address) === itemId(address));
    if (known) return known.refresh();
    if (this.items.size >= MAX_ITEMS || this.connection.closed) return;
    const item = new TrayItem(this.connection, address, this.icons, (key, extra) => this.show(key, extra));
    this.items.set(item.key, item);
    void item.start();
  }

  unregistered(id: string): void {
    const item = [...this.items.values()].find((each) => itemId(each.address) === id);
    if (item) this.remove(item);
  }

  /** `name` left the bus; its items go whether or not a watcher says so. */
  ownerGone(name: string): void {
    for (const item of [...this.items.values()]) if (item.address.bus === name) this.remove(item);
  }

  /** Every item goes (the watcher went away, or the tray is closing). */
  clear(): void {
    for (const item of [...this.items.values()]) this.remove(item);
  }

  private remove(item: TrayItem): void {
    this.items.delete(item.key);
    item.close();
    this.extras.drop(item.key);
  }

  private show(key: string, extra: MenuBarExtra | null): void {
    // A reading that lands after its item went is not shown.
    if (!this.items.has(key)) return;
    if (extra) this.extras.put(extra, this);
    else this.extras.drop(key);
  }

  activate(key: string, x: number, y: number): void {
    this.items.get(key)?.activate(x, y);
  }

  secondaryActivate(key: string, x: number, y: number): void {
    this.items.get(key)?.secondaryActivate(x, y);
  }

  menu(key: string): Promise<readonly ExtraMenuRow[]> {
    return this.items.get(key)?.menu() ?? Promise.resolve([]);
  }

  choose(key: string, id: string): void {
    this.items.get(key)?.choose(id);
  }

  menuClosed(key: string): void {
    this.items.get(key)?.menuClosed();
  }
}
