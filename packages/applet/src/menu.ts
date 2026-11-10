/**
 * An applet's menu rows. Version 1 had one level: items and separators, as
 * the app menus' rows. Version 2 adds submenus,
 * `{"type":"submenu","label":"Units","items":[…]}`, up to three levels deep;
 * the limits count every row at every level.
 */

import { id, isRefusal, optionalBoolean, type Refusal, record, refuse, text } from "@dashi/shape/kit";

export const MENU_LIMITS = {
  /** Rows at every level together, separators included. */
  rows: 40,
  /** Levels, the top one included. */
  depth: 3,
  label: 80,
  shortcut: 16,
} as const;

export type AppletMenuRow =
  | { kind: "item"; id: string; label: string; enabled: boolean; checked?: boolean }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; enabled: boolean; rows: AppletMenuRow[] };

/** What an applet writes: rows as the SDK and docs/applets.md spell them. */
export type MenuRowSpec =
  | { type?: "item"; id: string; label: string; enabled?: boolean; checked?: boolean; shortcut?: string }
  | { type: "separator" }
  | { type: "submenu"; label: string; enabled?: boolean; items: readonly MenuRowSpec[] };

interface Count {
  rows: number;
  ids: Set<string>;
}

function parseRow(value: unknown, where: string, depth: number, count: Count): AppletMenuRow | Refusal {
  if (++count.rows > MENU_LIMITS.rows) return refuse(`the menu has more than ${MENU_LIMITS.rows} rows`);
  const type = typeof value === "object" && value !== null ? (value as Record<string, unknown>).type : undefined;
  if (type === "separator") {
    const fields = record(value, where, ["type"]);
    return isRefusal(fields) ? fields : { kind: "separator" };
  }
  if (type === "submenu") {
    if (depth >= MENU_LIMITS.depth) return refuse(`${where}: menus go at most ${MENU_LIMITS.depth} levels deep`);
    const fields = record(value, where, ["type", "label", "enabled", "items"]);
    if (isRefusal(fields)) return fields;
    const label = text(fields.label, `${where}: label`, MENU_LIMITS.label);
    if (isRefusal(label)) return label;
    const enabled = optionalBoolean(fields.enabled, `${where}: enabled`);
    if (isRefusal(enabled)) return enabled;
    const rows = parseRows(fields.items, `${where} (“${label}”)`, depth + 1, count);
    if (isRefusal(rows)) return rows;
    return { kind: "submenu", label, enabled: enabled ?? true, rows };
  }
  // `shortcut` and `agents` were the app menus' fields, which v1 applets could send; they are taken and not shown.
  const fields = record(value, where, ["type", "id", "label", "shortcut", "enabled", "checked", "agents"]);
  if (isRefusal(fields)) return fields;
  if (fields.type !== undefined && fields.type !== "item") return refuse(`${where}: type must be "item", "separator", or "submenu"`);
  const rowId = id(fields.id, `${where}: id`);
  if (isRefusal(rowId)) return rowId;
  if (count.ids.has(rowId)) return refuse(`two rows are “${rowId}”`);
  count.ids.add(rowId);
  const label = text(fields.label, `${where}: label`, MENU_LIMITS.label);
  if (isRefusal(label)) return label;
  if (fields.shortcut !== undefined) {
    const shortcut = text(fields.shortcut, `${where}: shortcut`, MENU_LIMITS.shortcut);
    if (isRefusal(shortcut)) return shortcut;
  }
  const enabled = optionalBoolean(fields.enabled, `${where}: enabled`);
  if (isRefusal(enabled)) return enabled;
  const checked = optionalBoolean(fields.checked, `${where}: checked`);
  if (isRefusal(checked)) return checked;
  const agents = optionalBoolean(fields.agents, `${where}: agents`);
  if (isRefusal(agents)) return agents;
  return { kind: "item", id: rowId, label, enabled: enabled ?? true, ...(checked === undefined ? {} : { checked }) };
}

function parseRows(value: unknown, where: string, depth: number, count: Count): AppletMenuRow[] | Refusal {
  if (!Array.isArray(value)) return refuse(`${where}: menu must be a list`);
  const rows: AppletMenuRow[] = [];
  for (const [at, entry] of value.entries()) {
    const row = parseRow(entry, `${where}, row ${at + 1}`, depth, count);
    if (isRefusal(row)) return row;
    rows.push(row);
  }
  return tidy(rows);
}

/** A whole menu; `nested` false keeps version 1's single level. */
export function parseMenu(value: unknown, where: string, nested: boolean): AppletMenuRow[] | Refusal {
  const count: Count = { rows: 0, ids: new Set() };
  const rows = parseRows(value, where, 1, count);
  if (isRefusal(rows)) return rows.error.startsWith("two rows") || rows.error.startsWith("the menu") ? refuse(`${where}: ${rows.error}`) : rows;
  if (!nested && rows.some((row) => row.kind === "submenu")) return refuse(`${where}: submenus need protocol 2 (send hello first)`);
  return rows;
}

/** Separators only between rows: none first, last, or twice in a row; empty submenus go. */
export function tidy(rows: readonly AppletMenuRow[]): AppletMenuRow[] {
  const out: AppletMenuRow[] = [];
  for (const row of rows) {
    if (row.kind === "submenu" && row.rows.length === 0) continue;
    if (row.kind === "separator" && (out.length === 0 || out.at(-1)?.kind === "separator")) continue;
    out.push(row);
  }
  if (out.at(-1)?.kind === "separator") out.pop();
  return out;
}

/** Whether a row with this id can be chosen (it exists and it and every submenu above it are enabled). */
export function choosable(rows: readonly AppletMenuRow[], item: string): boolean {
  for (const row of rows) {
    if (row.kind === "item" && row.id === item) return row.enabled;
    if (row.kind === "submenu" && row.enabled && choosable(row.rows, item)) return true;
  }
  return false;
}
