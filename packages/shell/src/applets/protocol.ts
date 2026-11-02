/**
 * The applets channel, `$XDG_RUNTIME_DIR/dashi-applets.sock`: how a program
 * puts its own items in the menu bar's status area (docs/applets.md).
 * Newline-delimited JSON, one message per line.
 *
 *   applet → shell  {"type":"applet","applet":{"id":"weather","title":"Weather","glyph":"<svg …>","label":"21°",
 *                    "tooltip":"Clear, 21°","menu":[{"id":"refresh","label":"Refresh"}],"click":"menu"}}
 *                   {"type":"remove","id":"weather"}
 *   shell → applet  {"type":"activate","id":"weather","x":1210,"y":12}
 *                   {"type":"select","id":"weather","item":"refresh"}
 *                   {"type":"error","message":"…"}       (refused; the applet as it was stays)
 *
 * An "applet" message says everything about one applet and replaces what was
 * there under that id. Its picture is a `glyph` (SVG markup drawn as a
 * template, in the bar's text color, as Dashi's own) or an `icon` (an
 * absolute path to a PNG or SVG drawn as it is), a `label` (text beside it),
 * or both. `click` says what a click does: "activate" sends `activate`;
 * "menu" opens the menu; a right-click always opens the menu. Menu rows are
 * the app menus' rows (app-menus/protocol.ts). An applet goes when its
 * connection closes.
 *
 * What arrives is untrusted: unknown fields, wrong types, and anything over
 * the limits refuse the whole message; a glyph may not reach outside itself
 * (no images, links, entities, scripts, or styles).
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type AppMenuRow, id, isRefusal, optionalBoolean, parseRow, type Refusal, record, refuse, text, tidy } from "../app-menus/protocol.ts";

export const APPLETS_SOCKET = "dashi-applets.sock";

/** Where the shell listens; null without a runtime directory. */
export function appletsSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.XDG_RUNTIME_DIR;
  return dir ? join(dir, APPLETS_SOCKET) : null;
}

export const APPLET_LIMITS = {
  /** Bytes in one line; a longer one ends the connection. */
  line: 64 * 1024,
  /** Applets one connection may show at once. */
  perConnection: 8,
  title: 40,
  /** A label is short: the bar is shared. */
  label: 24,
  tooltip: 160,
  /** Bytes of SVG markup in a glyph. */
  glyph: 16 * 1024,
  /** Bytes of an icon file. */
  icon: 1024 * 1024,
  rows: 40,
} as const;

export interface Applet {
  id: string;
  title: string;
  glyph?: string;
  icon?: string;
  label?: string;
  tooltip?: string;
  menu: AppMenuRow[];
  /** What a primary click does. */
  click: "activate" | "menu";
  attention: boolean;
}

export type AppletMessage = { type: "applet"; applet: Applet } | { type: "remove"; id: string };

export type AppletShellMessage =
  | { type: "activate"; id: string; x: number; y: number }
  | { type: "select"; id: string; item: string }
  | { type: "error"; message: string };

/** What a glyph may not contain: anything that loads, links, or runs. */
const GLYPH_FORBIDDEN = /<\s*(image|script|style|foreignObject|use|a)\b|href\s*=|<!(ENTITY|DOCTYPE)|url\s*\(/i;

function parseGlyph(value: unknown): string | Refusal {
  if (typeof value !== "string") return refuse("glyph must be SVG markup");
  const markup = value.trim();
  if (new TextEncoder().encode(markup).byteLength > APPLET_LIMITS.glyph) return refuse(`glyph is larger than ${APPLET_LIMITS.glyph} bytes`);
  if (!/^<svg[\s>]/.test(markup) || !/<\/svg>$/.test(markup)) return refuse("glyph must be one <svg> element");
  if (GLYPH_FORBIDDEN.test(markup)) return refuse("glyph may not load, link, style, or run anything");
  return markup;
}

/** The icon file: absolute, a PNG or an SVG, a regular file of sane size. `stat` is the filesystem's (tests stand in). */
function parseIcon(value: unknown, stat: (path: string) => { file: boolean; size: number } | null): string | Refusal {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) return refuse("icon must be an absolute path");
  if (!/\.(png|svg)$/i.test(value)) return refuse("icon must be a .png or .svg file");
  const info = stat(value);
  if (!info?.file) return refuse("icon is not a file");
  if (info.size > APPLET_LIMITS.icon) return refuse(`icon is larger than ${APPLET_LIMITS.icon} bytes`);
  return value;
}

const fileStat = (path: string): { file: boolean; size: number } | null => {
  if (!existsSync(path)) return null;
  const info = statSync(path);
  return { file: info.isFile(), size: info.size };
};

export function parseApplet(value: unknown, stat = fileStat): Applet | Refusal {
  const fields = record(value, "the applet", ["id", "title", "glyph", "icon", "label", "tooltip", "menu", "click", "attention"]);
  if (isRefusal(fields)) return fields;
  const appletId = id(fields.id, "id");
  if (isRefusal(appletId)) return appletId;
  const where = `applet “${appletId}”`;
  const title = text(fields.title, `${where}: title`, APPLET_LIMITS.title);
  if (isRefusal(title)) return title;
  const glyph = fields.glyph === undefined ? undefined : parseGlyph(fields.glyph);
  if (isRefusal(glyph)) return refuse(`${where}: ${glyph.error}`);
  const icon = fields.icon === undefined ? undefined : parseIcon(fields.icon, stat);
  if (isRefusal(icon)) return refuse(`${where}: ${icon.error}`);
  const label = fields.label === undefined ? undefined : text(fields.label, `${where}: label`, APPLET_LIMITS.label);
  if (isRefusal(label)) return label;
  if (glyph === undefined && icon === undefined && label === undefined) return refuse(`${where} shows nothing: give a glyph, an icon, or a label`);
  if (glyph !== undefined && icon !== undefined) return refuse(`${where}: a glyph or an icon, not both`);
  const tooltip = fields.tooltip === undefined ? undefined : text(fields.tooltip, `${where}: tooltip`, APPLET_LIMITS.tooltip);
  if (isRefusal(tooltip)) return tooltip;
  const attention = optionalBoolean(fields.attention, `${where}: attention`);
  if (isRefusal(attention)) return attention;

  const menu: AppMenuRow[] = [];
  if (fields.menu !== undefined) {
    if (!Array.isArray(fields.menu)) return refuse(`${where}: menu must be a list`);
    if (fields.menu.length > APPLET_LIMITS.rows) return refuse(`${where}: menu has more than ${APPLET_LIMITS.rows} rows`);
    const seen = new Set<string>();
    for (const [at, entry] of fields.menu.entries()) {
      const row = parseRow(entry, `${where}, row ${at + 1}`);
      if (isRefusal(row)) return row;
      if (row.kind === "item") {
        if (seen.has(row.id)) return refuse(`${where}: two rows are “${row.id}”`);
        seen.add(row.id);
      }
      menu.push(row);
    }
  }
  const rows = tidy(menu);
  if (fields.click !== undefined && fields.click !== "activate" && fields.click !== "menu") return refuse(`${where}: click must be "activate" or "menu"`);
  const click = fields.click ?? (rows.length > 0 ? "menu" : "activate");
  if (click === "menu" && rows.length === 0) return refuse(`${where}: click is "menu" but there is no menu`);
  return {
    id: appletId,
    title,
    ...(glyph === undefined ? {} : { glyph }),
    ...(icon === undefined ? {} : { icon }),
    ...(label === undefined ? {} : { label }),
    ...(tooltip === undefined ? {} : { tooltip }),
    menu: rows,
    click,
    attention: attention ?? false,
  };
}

/** One line from an applet. */
export function parseAppletMessage(line: string, stat = fileStat): AppletMessage | Refusal {
  if (new TextEncoder().encode(line).byteLength > APPLET_LIMITS.line) return refuse(`a line is longer than ${APPLET_LIMITS.line} bytes`);
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return refuse("not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return refuse("the message must be an object");
  const type = (value as Record<string, unknown>).type;
  if (type === "remove") {
    const fields = record(value, "the message", ["type", "id"]);
    if (isRefusal(fields)) return fields;
    const appletId = id(fields.id, "id");
    return isRefusal(appletId) ? appletId : { type: "remove", id: appletId };
  }
  if (type !== "applet") return refuse('type must be "applet" or "remove"');
  const fields = record(value, "the message", ["type", "applet"]);
  if (isRefusal(fields)) return fields;
  const applet = parseApplet(fields.applet, stat);
  return isRefusal(applet) ? applet : { type: "applet", applet };
}

/** One line from the shell (an applet library's side); null for anything else. */
export function parseAppletShellMessage(line: string): AppletShellMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields.type === "error" && typeof fields.message === "string") return { type: "error", message: fields.message };
  if (typeof fields.id !== "string") return null;
  if (fields.type === "activate" && typeof fields.x === "number" && typeof fields.y === "number")
    return { type: "activate", id: fields.id, x: fields.x, y: fields.y };
  if (fields.type === "select" && typeof fields.item === "string") return { type: "select", id: fields.id, item: fields.item };
  return null;
}
