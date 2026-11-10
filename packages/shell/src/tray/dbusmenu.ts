/**
 * A tray item's menu over `com.canonical.dbusmenu`. The menu is read whole
 * each time it opens (AboutToShow, then GetLayout from the root) and
 * flattened into the bar's rows: a submenu becomes a heading with its items
 * indented under it. A choice goes back as a `clicked` event on the item's id.
 *
 * The layout is the app's, so it is untrusted: nodes that are not
 * `(ia{sv}av)` are skipped, labels are cleaned and cut, and the rows and the
 * nesting are capped.
 */

import type { ExtraMenuRow } from "../extras/index.ts";
import { clean } from "../notifications/index.ts";
import { type DBusConnection, propertyMap, Variant } from "../shared/dbus/index.ts";

export const DBUSMENU = "com.canonical.dbusmenu";

const MAX_ROWS = 400;
const MAX_DEPTH = 6;
const MAX_LABEL = 120;
/** Lazily filled submenus asked to fill before the layout is read again. */
const MAX_LAZY = 16;
const ABOUT_TO_SHOW_MS = 1500;
const LAYOUT_MS = 3000;

export interface LayoutNode {
  id: number;
  properties: Map<string, unknown>;
  children: LayoutNode[];
}

const isId = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0x7fffffff;

/** One `(ia{sv}av)` node and its children; null if it is not one. */
export function parseNode(value: unknown, depth = 0): LayoutNode | null {
  if (!Array.isArray(value) || depth > MAX_DEPTH + 1) return null;
  const [id, rawProperties, rawChildren] = value;
  const properties = propertyMap(rawProperties);
  if (!isId(id) || !properties || !Array.isArray(rawChildren)) return null;
  const children: LayoutNode[] = [];
  for (const child of rawChildren) {
    const node = parseNode(child instanceof Variant ? child.value : child, depth + 1);
    if (node) children.push(node);
  }
  return { id, properties, children };
}

/** A GetLayout reply's body (`u(ia{sv}av)`): the root node, or null. */
export function parseLayoutReply(body: readonly unknown[]): LayoutNode | null {
  return parseNode(body[1]);
}

/** A label without its mnemonic marks: `_File` is "File", `__` is a literal underscore. */
export const stripMnemonic = (label: string): string => label.replace(/_(.)/gsu, "$1");

const isSubmenu = (node: LayoutNode): boolean => node.properties.get("children-display") === "submenu" || node.children.length > 0;

function addRows(node: LayoutNode, depth: number, out: ExtraMenuRow[]): void {
  for (const child of node.children) {
    if (out.length >= MAX_ROWS) return;
    const properties = child.properties;
    if (properties.get("visible") === false) continue;
    if (properties.get("type") === "separator") {
      out.push({ kind: "separator" });
      continue;
    }
    const label = properties.get("label");
    const row: ExtraMenuRow = {
      kind: "item",
      id: String(child.id),
      label: typeof label === "string" ? clean(stripMnemonic(label), MAX_LABEL) : "",
      enabled: properties.get("enabled") !== false,
    };
    if (depth > 0) row.depth = depth;
    if (isSubmenu(child)) {
      // No nested popups yet: the submenu's items follow its name, indented.
      const at = out.length;
      out.push({ ...row, enabled: false, heading: true });
      if (depth < MAX_DEPTH) addRows(child, depth + 1, out);
      if (out.length === at + 1) out.pop();
      continue;
    }
    const toggle = properties.get("toggle-type");
    if (toggle === "checkmark" || toggle === "radio") row.checked = properties.get("toggle-state") === 1;
    out.push(row);
  }
}

/** Separators only between items: none first, last, or twice in a row. */
function tidySeparators(rows: readonly ExtraMenuRow[]): ExtraMenuRow[] {
  const tidy: ExtraMenuRow[] = [];
  for (const row of rows) {
    if (row.kind === "separator" && (tidy.length === 0 || tidy.at(-1)?.kind === "separator")) continue;
    tidy.push(row);
  }
  if (tidy.at(-1)?.kind === "separator") tidy.pop();
  return tidy;
}

/** The bar's rows for a menu's root node: hidden items out, submenus flattened. */
export function menuRows(root: LayoutNode): ExtraMenuRow[] {
  const rows: ExtraMenuRow[] = [];
  addRows(root, 0, rows);
  return tidySeparators(rows);
}

/** Submenus that say they have children but sent none: Qt fills those when they are about to show. */
export function lazySubmenus(root: LayoutNode): number[] {
  const ids: number[] = [];
  const visit = (node: LayoutNode): void => {
    for (const child of node.children) {
      if (child.properties.get("visible") === false) continue;
      if (child.properties.get("children-display") === "submenu" && child.children.length === 0) ids.push(child.id);
      visit(child);
    }
  };
  visit(root);
  return ids.slice(0, MAX_LAZY);
}

export interface MenuTarget {
  bus: string;
  path: string;
}

const call = (connection: DBusConnection, target: MenuTarget, member: string, signature: string, body: unknown[], timeoutMs: number) =>
  connection.call({ destination: target.bus, path: target.path, interface: DBUSMENU, member, signature, body }, timeoutMs);

/** Whether AboutToShow said the layout changed; an app that doesn't implement it changed nothing. */
async function aboutToShow(connection: DBusConnection, target: MenuTarget, id: number): Promise<boolean> {
  try {
    const [needUpdate] = await call(connection, target, "AboutToShow", "i", [id], ABOUT_TO_SHOW_MS);
    return needUpdate === true;
  } catch {
    return false;
  }
}

async function layout(connection: DBusConnection, target: MenuTarget): Promise<LayoutNode | null> {
  return parseLayoutReply(await call(connection, target, "GetLayout", "iias", [0, -1, []], LAYOUT_MS));
}

/** The menu's rows now; empty when the app doesn't answer. */
export async function readMenu(connection: DBusConnection, target: MenuTarget): Promise<ExtraMenuRow[]> {
  try {
    await aboutToShow(connection, target, 0);
    let root = await layout(connection, target);
    if (!root) return [];
    const lazy = lazySubmenus(root);
    if (lazy.length > 0) {
      const changed = await Promise.all(lazy.map((id) => aboutToShow(connection, target, id)));
      if (changed.some(Boolean)) root = (await layout(connection, target)) ?? root;
    }
    return menuRows(root);
  } catch (error) {
    console.error(`dashi-shell: tray: ${target.bus} gave no menu: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** A row id the bar reports back, as the dbusmenu item id; null for anything else. */
export function parseRowId(id: string): number | null {
  if (!/^\d{1,10}$/.test(id)) return null;
  const value = Number(id);
  return isId(value) ? value : null;
}

/** Tell the app about its menu: `clicked` on an item, `opened` and `closed` on the root. */
export function menuEvent(connection: DBusConnection, target: MenuTarget, id: number, event: "clicked" | "opened" | "closed"): void {
  if (connection.closed) return;
  // Event times are milliseconds on a clock of the host's, as X11's are; only their order matters.
  const timestamp = Math.floor(performance.now()) >>> 0;
  connection
    .call({
      destination: target.bus,
      path: target.path,
      interface: DBUSMENU,
      member: "Event",
      signature: "isvu",
      body: [id, event, new Variant("i", 0), timestamp],
      noReply: true,
    })
    .catch(() => {});
}
