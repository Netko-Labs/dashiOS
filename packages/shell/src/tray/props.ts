/**
 * A StatusNotifierItem's properties (`org.kde.StatusNotifierItem`, GetAll)
 * read into plain values, and the menu bar extra they make. What an app sends
 * is untrusted: wrong types read as absent, text is cleaned and cut, and a
 * pixmap that does not add up is skipped.
 */

import type { ExtraIcon, MenuBarExtra } from "../extras/types.ts";
import { clean, plainBody } from "../notifications/text.ts";
import { propertyMap } from "../shared/dbus/properties.ts";
import { type Pixmap, parsePixmaps } from "./png.ts";

export type ItemStatus = "Passive" | "Active" | "NeedsAttention";

export interface ItemProperties {
  id: string;
  title: string;
  status: ItemStatus;
  iconName: string;
  iconPixmaps: Pixmap[];
  attentionIconName: string;
  attentionIconPixmaps: Pixmap[];
  /** A directory the app keeps its own icons in, searched before the themes. */
  iconThemePath: string;
  toolTip: { title: string; description: string } | null;
  itemIsMenu: boolean;
  /** The dbusmenu object on the item's connection, or null when it has none. */
  menu: string | null;
}

/** What to draw: an icon name to look up, else the pixmaps. */
export interface IconSource {
  name: string;
  pixmaps: readonly Pixmap[];
  themePath: string;
}

const LIMITS = { title: 80, tooltip: 300, name: 255 } as const;

const STATUSES: readonly ItemStatus[] = ["Passive", "Active", "NeedsAttention"];

/** Paths that say "no menu": none at all, the root, and what Qt sets on an icon without one. */
const NO_MENU = new Set(["", "/", "/NO_DBUSMENU"]);

const text = (value: unknown, max: number): string => (typeof value === "string" ? clean(value, max).trim() : "");

const name = (value: unknown): string => (typeof value === "string" && value.length <= LIMITS.name ? value : "");

function toolTip(value: unknown): ItemProperties["toolTip"] {
  if (!Array.isArray(value)) return null;
  const [, , title, description] = value;
  const parsed = {
    title: text(title, LIMITS.title),
    description: typeof description === "string" ? clean(plainBody(description), LIMITS.tooltip).trim() : "",
  };
  return parsed.title || parsed.description ? parsed : null;
}

/** A GetAll reply (or a PropertiesChanged dictionary) as the item's properties; null if it is not a dictionary. */
export function parseItemProperties(reply: unknown): ItemProperties | null {
  const properties = propertyMap(reply);
  if (!properties) return null;
  const status = properties.get("Status");
  const menu = properties.get("Menu");
  return {
    id: text(properties.get("Id"), LIMITS.title),
    title: text(properties.get("Title"), LIMITS.title),
    // An app that says nothing (or something new) about its status is shown.
    status: STATUSES.find((each) => each === status) ?? "Active",
    iconName: name(properties.get("IconName")),
    iconPixmaps: parsePixmaps(properties.get("IconPixmap")),
    attentionIconName: name(properties.get("AttentionIconName")),
    attentionIconPixmaps: parsePixmaps(properties.get("AttentionIconPixmap")),
    iconThemePath: name(properties.get("IconThemePath")),
    toolTip: toolTip(properties.get("ToolTip")),
    itemIsMenu: properties.get("ItemIsMenu") === true,
    menu: typeof menu === "string" && !NO_MENU.has(menu) ? menu : null,
  };
}

/** The icon to draw: the attention icon while the item asks for attention and has one, else its own. */
export function iconSource(properties: ItemProperties): IconSource {
  const themePath = properties.iconThemePath;
  const attention = properties.status === "NeedsAttention";
  if (attention && (properties.attentionIconName || properties.attentionIconPixmaps.length > 0)) {
    return { name: properties.attentionIconName, pixmaps: properties.attentionIconPixmaps, themePath };
  }
  return { name: properties.iconName, pixmaps: properties.iconPixmaps, themePath };
}

function tooltipText(properties: ItemProperties): string | undefined {
  const tip = properties.toolTip;
  if (!tip) return undefined;
  return [tip.title, tip.description].filter(Boolean).join("\n");
}

/** The extra an item shows as, or null while it is Passive (not shown until it is Active again). */
export function itemExtra(key: string, properties: ItemProperties, icon: ExtraIcon | null): MenuBarExtra | null {
  if (properties.status === "Passive") return null;
  const hasMenu = properties.menu !== null;
  const extra: MenuBarExtra = {
    key,
    source: "tray",
    title: properties.title || properties.id,
    icon,
    attention: properties.status === "NeedsAttention",
    // An item that is only a menu but has no dbusmenu to show is activated instead.
    menuOnClick: properties.itemIsMenu && hasMenu,
    hasMenu,
  };
  const tooltip = tooltipText(properties);
  if (tooltip) extra.tooltip = tooltip;
  return extra;
}
