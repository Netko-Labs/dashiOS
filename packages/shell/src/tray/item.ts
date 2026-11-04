/**
 * One registered StatusNotifierItem, followed live: its properties are read
 * with GetAll and read again whenever it says something changed (NewIcon,
 * NewTitle, NewStatus, …, or PropertiesChanged), and each reading becomes the
 * extra it shows as, or none while it is Passive. Clicks and its menu go back
 * to it from here.
 *
 * Readings are serialized: a signal during a read marks the item stale and
 * one more read follows, so an app that sends a burst of NewIcon costs two
 * calls and the last answer always wins.
 */

import type { DBusConnection } from "../dbus/connection.ts";
import { DBusError } from "../dbus/errors.ts";
import type { ExtraIcon, ExtraMenuRow, MenuBarExtra } from "../extras/types.ts";
import { type ItemAddress, itemKey } from "./address.ts";
import { type MenuTarget, menuEvent, parseRowId, readMenu } from "./dbusmenu.ts";
import type { TrayIcons } from "./icon.ts";
import { type ItemProperties, iconSource, itemExtra, parseItemProperties } from "./props.ts";

export const ITEM_INTERFACE = "org.kde.StatusNotifierItem";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const READ_MS = 5000;

const toInt32 = (value: number): number => Math.max(-0x80000000, Math.min(0x7fffffff, Math.round(Number.isFinite(value) ? value : 0)));

export class TrayItem {
  readonly key: string;
  private properties: ItemProperties | null = null;
  private icon: ExtraIcon | null = null;
  private reading: Promise<void> | null = null;
  private stale = false;
  private closed = false;
  private readonly stops: (() => Promise<void>)[] = [];

  constructor(
    private readonly connection: DBusConnection,
    readonly address: ItemAddress,
    private readonly icons: TrayIcons,
    /** The extra to show now, or null to show none. */
    private readonly publish: (key: string, extra: MenuBarExtra | null) => void,
  ) {
    this.key = itemKey(address);
  }

  /** Follow the item's signals, then read it. */
  async start(): Promise<void> {
    const { bus, path } = this.address;
    try {
      const subscriptions = await Promise.all([
        this.connection.subscribe({ type: "signal", sender: bus, path, interface: ITEM_INTERFACE }, () => this.refresh()),
        this.connection.subscribe({ type: "signal", sender: bus, path, interface: PROPERTIES, member: "PropertiesChanged" }, (message) => {
          if (message.body[0] === ITEM_INTERFACE) this.refresh();
        }),
      ]);
      if (this.closed) for (const stop of subscriptions) void stop().catch(() => {});
      else this.stops.push(...subscriptions);
    } catch (error) {
      if (!this.closed) console.error(`dashi-shell: tray: can't follow ${bus}${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.refresh();
    await this.reading;
  }

  /** Read the item again (now, or after the read in progress). */
  refresh(): void {
    if (this.closed) return;
    if (this.reading) {
      this.stale = true;
      return;
    }
    this.reading = this.readLoop().finally(() => {
      this.reading = null;
    });
  }

  private async readLoop(): Promise<void> {
    do {
      this.stale = false;
      await this.read();
    } while (this.stale && !this.closed);
  }

  private async read(): Promise<void> {
    const { bus, path } = this.address;
    let reply: unknown;
    try {
      [reply] = await this.connection.call(
        { destination: bus, path, interface: PROPERTIES, member: "GetAll", signature: "s", body: [ITEM_INTERFACE] },
        READ_MS,
      );
    } catch (error) {
      // An item that is gone is dropped by the watcher; one that answers badly keeps what it showed.
      if (!this.closed && !(error instanceof DBusError && error.errorName.endsWith(".ServiceUnknown"))) {
        console.error(`dashi-shell: tray: can't read ${bus}${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (this.closed) return;
    const properties = parseItemProperties(reply);
    if (!properties) return;
    this.properties = properties;
    this.show(properties);
  }

  private show(properties: ItemProperties): void {
    const previous = this.icon;
    this.icon = properties.status === "Passive" ? null : this.icons.resolve(iconSource(properties));
    // After the new one is held, so a picture that did not change is not rewritten.
    this.icons.release(previous);
    this.publish(this.key, itemExtra(this.key, properties, this.icon));
  }

  private get menuTarget(): MenuTarget | null {
    const menu = this.properties?.menu;
    return menu ? { bus: this.address.bus, path: menu } : null;
  }

  private invoke(member: "Activate" | "SecondaryActivate", x: number, y: number): void {
    if (this.closed || this.connection.closed) return;
    const { bus, path } = this.address;
    this.connection
      .call({ destination: bus, path, interface: ITEM_INTERFACE, member, signature: "ii", body: [toInt32(x), toInt32(y)] })
      .catch((error: unknown) => {
        console.error(`dashi-shell: tray: ${member} on ${bus}${path} failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  activate(x: number, y: number): void {
    this.invoke("Activate", x, y);
  }

  secondaryActivate(x: number, y: number): void {
    this.invoke("SecondaryActivate", x, y);
  }

  /** The item's dbusmenu as rows; none when it has no menu (a click activates it instead). */
  async menu(): Promise<readonly ExtraMenuRow[]> {
    const target = this.menuTarget;
    if (!target || this.closed) return [];
    const rows = await readMenu(this.connection, target);
    if (rows.length > 0) menuEvent(this.connection, target, 0, "opened");
    return rows;
  }

  choose(id: string): void {
    const target = this.menuTarget;
    const item = parseRowId(id);
    if (target && item !== null) menuEvent(this.connection, target, item, "clicked");
  }

  menuClosed(): void {
    const target = this.menuTarget;
    if (target) menuEvent(this.connection, target, 0, "closed");
  }

  /** Stop following the item; its extra is the caller's to drop. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops.splice(0)) void stop().catch(() => {});
    this.icons.release(this.icon);
    this.icon = null;
  }
}
