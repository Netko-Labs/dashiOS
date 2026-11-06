/**
 * The menus channel between an app and the shell, `$XDG_RUNTIME_DIR/dashi-menus.sock`:
 * newline-delimited JSON, one message per line.
 *
 *   app → shell  {"type":"menus","menus":[{"id":"file","items":[{"id":"new","label":"New Note","shortcut":"❖N"}]}],"typing":true}
 *   shell → app  {"type":"select","id":"new"}
 *                {"type":"quit"}                    (the app is quitting: its window's close request comes next)
 *                {"type":"error","message":"…"}     (the menus sent were refused; the last good ones stay)
 *
 * `typing` (optional) says a text field in the app's window has the
 * keyboard: then the text chords (❖A, ❖C, ❖X, ❖V, ❖Z, ⇧❖Z) go to the field,
 * as Ctrl chords, before the app's rows that show them (shortcut.ts
 * `TEXT_SHORTCUTS`), so ❖A in a rename field selects its text, not the files.
 * The app sends its menus again whenever it changes.
 *
 * Each "menus" message replaces everything the app published before; an
 * empty list takes its menus down. A menu with id `app` adds rows to the app
 * menu (under About); `file`, `edit`, and `view` take the place of Dashi's
 * own and may leave out their title; any other menu needs one. `dashi`,
 * `window`, and `help` stay the shell's. Rows are items (`id`, `label`,
 * optional `shortcut` written the Dashi way like "❖N", `enabled`, `checked`)
 * or `{"type":"separator"}`; item ids are unique across all the menus, since
 * a selection names only the id.
 *
 * What arrives is untrusted: unknown fields, wrong types, and anything over
 * the limits refuse the whole message.
 */

import { join } from "node:path";

export const MENUS_SOCKET = "dashi-menus.sock";

/** Where the shell listens; null without a runtime directory. */
export function menusSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.XDG_RUNTIME_DIR;
  return dir ? join(dir, MENUS_SOCKET) : null;
}

export const LIMITS = {
  /** Bytes in one line; a longer one ends the connection. */
  line: 64 * 1024,
  /** Menus in one message, the `app` one included. */
  menus: 10,
  /** Rows in one menu, separators included. */
  rows: 60,
  /** Rows in all the menus together. */
  total: 300,
  /** Characters (code points) of an id, a label, a title, a shortcut. */
  id: 64,
  label: 80,
  title: 40,
  shortcut: 16,
} as const;

export type AppMenuItem = {
  kind: "item";
  id: string;
  label: string;
  /** Written the Dashi way ("⇧❖Z"); only shown, the app binds its own keys. */
  shortcut?: string;
  enabled: boolean;
  /** Present (true or false) puts a check gutter in the menu, as a set of choices has. */
  checked?: boolean;
  /** False: the person's alone; an agent's choose_menu_item is refused (the app has a tool that asks first, such as Software's install). */
  agents?: false;
};

export type AppMenuRow = AppMenuItem | { kind: "separator" };

export interface AppMenu {
  id: string;
  /** "" for the `app` menu: the bar shows the app's name there. */
  title: string;
  items: readonly AppMenuRow[];
}

/** What an app sends: rows as the kit writes them. */
export type MenuItemSpec =
  | { type?: "item"; id: string; label: string; shortcut?: string; enabled?: boolean; checked?: boolean; agents?: boolean }
  | { type: "separator" };

export interface MenuSpec {
  id: string;
  title?: string;
  items: readonly MenuItemSpec[];
}

export type ClientMessage = { type: "menus"; menus: AppMenu[]; typing?: boolean };
export type ShellMessage = { type: "select"; id: string } | { type: "quit" } | { type: "error"; message: string };

/** The menus an app published, and which process it is. */
export interface PublishedMenus {
  pid: number;
  menus: readonly AppMenu[];
  /** A text field in its window has the keyboard: the text chords are the field's. */
  typing?: true;
}

/** Titles the bar gives these menus when the app leaves the title out. */
export const STANDARD_TITLES: Readonly<Record<string, string>> = { file: "File", edit: "Edit", view: "View" };
/** Menus that stay the shell's. */
export const RESERVED_MENUS: ReadonlySet<string> = new Set(["dashi", "window", "help"]);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// Control characters, and the bidi overrides that could make a label read as another.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/u;

/** A message, or part of one, that was refused, and why (shared with applets/protocol.ts). */
export type Refusal = { error: string };
export const refuse = (error: string): Refusal => ({ error });
export const isRefusal = (value: unknown): value is Refusal => typeof value === "object" && value !== null && "error" in value;

export function record(value: unknown, what: string, allowed: readonly string[]): Record<string, unknown> | Refusal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse(`${what} must be an object`);
  const stray = Object.keys(value).find((key) => !allowed.includes(key));
  return stray === undefined ? (value as Record<string, unknown>) : refuse(`${what} has an unknown field “${stray}”`);
}

const length = (text: string): number => [...text].length;

export function text(value: unknown, what: string, max: number): string | Refusal {
  if (typeof value !== "string") return refuse(`${what} must be a string`);
  const trimmed = value.trim();
  if (trimmed === "") return refuse(`${what} is empty`);
  if (length(trimmed) > max) return refuse(`${what} is longer than ${max} characters`);
  if (UNSAFE.test(trimmed)) return refuse(`${what} has control characters`);
  return trimmed;
}

export function id(value: unknown, what: string): string | Refusal {
  if (typeof value !== "string" || !ID.test(value)) return refuse(`${what} must be letters, digits, and . _ : -, starting with a letter or digit`);
  return value.length > LIMITS.id ? refuse(`${what} is longer than ${LIMITS.id} characters`) : value;
}

export function optionalBoolean(value: unknown, what: string): boolean | undefined | Refusal {
  if (value === undefined || typeof value === "boolean") return value;
  return refuse(`${what} must be true or false`);
}

export function parseRow(value: unknown, where: string): AppMenuRow | Refusal {
  if (typeof value === "object" && value !== null && (value as Record<string, unknown>).type === "separator") {
    const separator = record(value, where, ["type"]);
    return isRefusal(separator) ? separator : { kind: "separator" };
  }
  const fields = record(value, where, ["type", "id", "label", "shortcut", "enabled", "checked", "agents"]);
  if (isRefusal(fields)) return fields;
  if (fields.type !== undefined && fields.type !== "item") return refuse(`${where}: type must be "item" or "separator"`);
  const itemId = id(fields.id, `${where}: id`);
  if (isRefusal(itemId)) return itemId;
  const label = text(fields.label, `${where}: label`, LIMITS.label);
  if (isRefusal(label)) return label;
  const shortcut = fields.shortcut === undefined ? undefined : text(fields.shortcut, `${where}: shortcut`, LIMITS.shortcut);
  if (isRefusal(shortcut)) return shortcut;
  const enabled = optionalBoolean(fields.enabled, `${where}: enabled`);
  if (isRefusal(enabled)) return enabled;
  const checked = optionalBoolean(fields.checked, `${where}: checked`);
  if (isRefusal(checked)) return checked;
  const agents = optionalBoolean(fields.agents, `${where}: agents`);
  if (isRefusal(agents)) return agents;
  return {
    kind: "item",
    id: itemId,
    label,
    ...(shortcut === undefined ? {} : { shortcut }),
    enabled: enabled ?? true,
    ...(checked === undefined ? {} : { checked }),
    ...(agents === false ? { agents: false as const } : {}),
  };
}

/** Separators only between items: none first, last, or twice in a row. */
export function tidy(rows: readonly AppMenuRow[]): AppMenuRow[] {
  const out: AppMenuRow[] = [];
  for (const row of rows) {
    if (row.kind === "separator" && (out.length === 0 || out.at(-1)?.kind === "separator")) continue;
    out.push(row);
  }
  if (out.at(-1)?.kind === "separator") out.pop();
  return out;
}

function parseMenu(value: unknown, index: number): AppMenu | Refusal {
  const fields = record(value, `menu ${index + 1}`, ["id", "title", "items"]);
  if (isRefusal(fields)) return fields;
  const menuId = id(fields.id, `menu ${index + 1}: id`);
  if (isRefusal(menuId)) return menuId;
  const where = `menu “${menuId}”`;
  if (RESERVED_MENUS.has(menuId)) return refuse(`${where} is the shell's own`);
  const standard = STANDARD_TITLES[menuId];
  let title: string;
  if (menuId === "app") {
    if (fields.title !== undefined) return refuse(`${where} has no title: the bar shows the app's name`);
    title = "";
  } else if (fields.title === undefined && standard !== undefined) {
    title = standard;
  } else {
    const given = text(fields.title, `${where}: title`, LIMITS.title);
    if (isRefusal(given)) return given;
    title = given;
  }
  if (!Array.isArray(fields.items)) return refuse(`${where}: items must be a list`);
  if (fields.items.length > LIMITS.rows) return refuse(`${where} has more than ${LIMITS.rows} rows`);
  const rows: AppMenuRow[] = [];
  for (const [at, item] of fields.items.entries()) {
    const row = parseRow(item, `${where}, row ${at + 1}`);
    if (isRefusal(row)) return row;
    rows.push(row);
  }
  return { id: menuId, title, items: tidy(rows) };
}

/** The menus of a "menus" message (or what the kit is about to send). */
export function parseMenus(value: unknown): AppMenu[] | Refusal {
  if (!Array.isArray(value)) return refuse("menus must be a list");
  if (value.length > LIMITS.menus) return refuse(`more than ${LIMITS.menus} menus`);
  const menus: AppMenu[] = [];
  for (const [index, entry] of value.entries()) {
    const menu = parseMenu(entry, index);
    if (isRefusal(menu)) return menu;
    menus.push(menu);
  }
  const menuIds = new Set<string>();
  const itemIds = new Set<string>();
  let total = 0;
  for (const menu of menus) {
    if (menuIds.has(menu.id)) return refuse(`two menus are “${menu.id}”`);
    menuIds.add(menu.id);
    total += menu.items.length;
    for (const row of menu.items) {
      if (row.kind !== "item") continue;
      if (itemIds.has(row.id)) return refuse(`two items are “${row.id}”`);
      itemIds.add(row.id);
    }
  }
  if (total > LIMITS.total) return refuse(`more than ${LIMITS.total} rows in all`);
  return menus;
}

/** One line from an app. */
export function parseClientMessage(line: string): ClientMessage | Refusal {
  if (new TextEncoder().encode(line).byteLength > LIMITS.line) return refuse(`a line is longer than ${LIMITS.line} bytes`);
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return refuse("not JSON");
  }
  const fields = record(value, "the message", ["type", "menus", "typing"]);
  if (isRefusal(fields)) return fields;
  if (fields.type !== "menus") return refuse('type must be "menus"');
  const typing = optionalBoolean(fields.typing, "typing");
  if (isRefusal(typing)) return typing;
  const menus = parseMenus(fields.menus);
  if (isRefusal(menus)) return menus;
  return typing ? { type: "menus", menus, typing } : { type: "menus", menus };
}

/** One line from the shell (the kit's side); null for anything else. */
export function parseShellMessage(line: string): ShellMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields.type === "select" && typeof fields.id === "string") return { type: "select", id: fields.id };
  if (fields.type === "quit") return { type: "quit" };
  if (fields.type === "error" && typeof fields.message === "string") return { type: "error", message: fields.message };
  return null;
}

/** The item `id` of these menus, if it is there and can be chosen. */
export function enabledItem(menus: readonly AppMenu[], itemId: string): AppMenuItem | null {
  for (const menu of menus) {
    for (const row of menu.items) if (row.kind === "item" && row.id === itemId) return row.enabled ? row : null;
  }
  return null;
}
