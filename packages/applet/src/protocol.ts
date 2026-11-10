/**
 * The applets channel, `$XDG_RUNTIME_DIR/dashi-applets.sock`: how a program
 * puts its own items in the menu bar's status area (docs/applets.md).
 * Newline-delimited JSON, one message per line. The shell parses with this
 * module (its src/applets/protocol.ts is the facade), and so does the client,
 * so both sides refuse the same things.
 *
 * Version 1:
 *   applet → shell  {"type":"applet","applet":{…}}  {"type":"remove","id":"weather"}
 *   shell → applet  {"type":"activate","id","x","y"}  {"type":"select","id","item"}  {"type":"error","message"}
 * Version 2 adds, first on the connection:
 *   applet → shell  {"type":"hello","protocol":2,"manifest":{…},"dev"?:true}
 *   shell → applet  {"type":"welcome","protocol":2}
 * and then popovers and nested menus:
 *   applet → shell  {"type":"popover","id","width","height"}   (open one under the item `id`)
 *                   {"type":"dismiss","id"}                      (it closed)
 *   shell → applet  {"type":"popover","id","x","y","width","height","output","namespace"}  (where to put it)
 *                   {"type":"dismiss","id"}                      (close it: a click outside, the item again)
 * Version 3 (a hello with `"protocol":3`) adds the launcher's commands
 * (commands.ts; the manifest declares them):
 *   shell → applet  {"type":"run","seq","command","args","query"?,"item"?}   (run it; a pick command's rows for `query`; the row chosen)
 *   applet → shell  {"type":"result","seq","text"|"copy"|"open"|"error"}    (what it came to)
 *                   {"type":"items","seq","rows":[{"id","title","detail"?}]} (a pick command's rows, drawn by the shell)
 *                   {"type":"view","seq","height"}                          (a view command draws its answer itself, this tall)
 *   shell → applet  {"type":"view","seq","x","y","width","height","output","namespace"}  (where)
 *   either way      {"type":"dismiss","seq"}                                 (the view closed)
 * Version 4 adds Dashi's power mode, for an applet with the `power.mode`
 * permission (power.ts):
 *   shell → applet  {"type":"power","choice","available","mode","automatic","why","failed"}  (after welcome, and on every change)
 *   applet → shell  {"type":"power","choice"}                                (ask for Automatic or a mode)
 * Version 5 adds Control Center's controls, for an applet that declares
 * them and has the `controls` permission (controls.ts):
 *   shell → applet  {"type":"controls","shown":[…]}                          (which of its controls are in Control Center)
 *                   {"type":"control-action","id","action",…}               (one was pressed)
 *   applet → shell  {"type":"control","id","on"?,"detail"?,"choice"?,"value"?,"glyph"?}  (its state)
 * A connection that starts with anything but `hello` is version 1, and
 * stays so. A hello's protocol is the newest the applet speaks; the
 * connection speaks the older of it and the shell's.
 */

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { id, integer, isRefusal, optionalBoolean, type Refusal, record, refuse, text, typedObject } from "@dashi/shape/kit";
import { COMMAND_LIMITS, type CommandResult, type CommandRow, parseResult, parseRows } from "./commands.ts";
import { type ControlAction, type ControlUpdate, parseControlAction, parseControlUpdate, parseShown } from "./controls.ts";
import { type Manifest, parseManifest } from "./manifest.ts";
import { type AppletMenuRow, parseMenu } from "./menu.ts";
import { type PowerChoice, type PowerState, parsePowerAsk, parsePowerState } from "./power.ts";

export const PROTOCOL = 5;
export const APPLETS_SOCKET = "dashi-applets.sock";

/** Where the shell listens; null without a runtime directory. `DASHI_APPLETS_SOCKET` puts it elsewhere (the sandbox's own). */
export function appletsSocketPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.DASHI_APPLETS_SOCKET) return env.DASHI_APPLETS_SOCKET;
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
  /** A popover's size in points: the smallest and largest asked for. */
  popover: { minWidth: 120, minHeight: 48, maxWidth: 720, maxHeight: 900 },
} as const;

export interface Applet {
  id: string;
  title: string;
  glyph?: string;
  icon?: string;
  label?: string;
  tooltip?: string;
  menu: AppletMenuRow[];
  /** What a primary click does. */
  click: "activate" | "menu";
  attention: boolean;
}

export type AppletMessage =
  | { type: "hello"; protocol: number; manifest: Manifest; dev: boolean }
  | { type: "applet"; applet: Applet }
  | { type: "remove"; id: string }
  | { type: "popover"; id: string; width: number; height: number }
  | { type: "dismiss"; id: string }
  | { type: "result"; seq: number; result: CommandResult }
  | { type: "items"; seq: number; rows: CommandRow[] }
  | { type: "view"; seq: number; height: number }
  /** `{"type":"dismiss","seq"}`: the view of run `seq` closed. */
  | { type: "dismiss-view"; seq: number }
  /** Version 4: Automatic or a mode, asked for (`power.mode`). */
  | { type: "power"; choice: PowerChoice }
  /** Version 5: a control's state (`controls`). */
  | ({ type: "control" } & ControlUpdate);

/** A command run's number: the shell counts them up from 1. */
export const MAX_SEQ = 2 ** 31;

/** Where the shell put a popover: the top-left corner in the screen's own points, on `output`, and the size it may take. */
export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The screen (output name) or null when the shell can't tell. */
  output: string | null;
}

export type AppletShellMessage =
  | { type: "welcome"; protocol: number }
  | { type: "activate"; id: string; x: number; y: number }
  | { type: "select"; id: string; item: string }
  | { type: "error"; message: string }
  | ({ type: "popover"; id: string; namespace: string } & Placement)
  | { type: "dismiss"; id: string }
  | { type: "run"; seq: number; command: string; args: Record<string, string | number | boolean>; query?: string; item?: string }
  | ({ type: "view"; seq: number; namespace: string } & Placement)
  | { type: "dismiss-view"; seq: number }
  | ({ type: "power" } & PowerState)
  /** Version 5: which of its controls are in Control Center. */
  | { type: "controls"; shown: string[] }
  /** Version 5: one of its controls was pressed. */
  | ({ type: "control-action"; id: string } & ControlAction);

/** What a glyph may not contain: anything that loads, links, or runs. */
const GLYPH_FORBIDDEN = /<\s*(image|script|style|foreignObject|use|a)\b|href\s*=|<!(ENTITY|DOCTYPE)|url\s*\(/i;

export function parseGlyph(value: unknown): string | Refusal {
  if (typeof value !== "string") return refuse("glyph must be SVG markup");
  const markup = value.trim();
  if (new TextEncoder().encode(markup).byteLength > APPLET_LIMITS.glyph) return refuse(`glyph is larger than ${APPLET_LIMITS.glyph} bytes`);
  if (!/^<svg[\s>]/.test(markup) || !/<\/svg>$/.test(markup)) return refuse("glyph must be one <svg> element");
  if (GLYPH_FORBIDDEN.test(markup)) return refuse("glyph may not load, link, style, or run anything");
  return markup;
}

export type Stat = (path: string) => { file: boolean; size: number } | null;

/** The icon file: absolute, a PNG or an SVG, a regular file of sane size. */
function parseIcon(value: unknown, stat: Stat): string | Refusal {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) return refuse("icon must be an absolute path");
  if (!/\.(png|svg)$/i.test(value)) return refuse("icon must be a .png or .svg file");
  const info = stat(value);
  if (!info?.file) return refuse("icon is not a file");
  if (info.size > APPLET_LIMITS.icon) return refuse(`icon is larger than ${APPLET_LIMITS.icon} bytes`);
  return value;
}

export const fileStat: Stat = (path) => {
  if (!existsSync(path)) return null;
  const info = statSync(path);
  return { file: info.isFile(), size: info.size };
};

/** One applet; `nested` allows version 2's submenus. */
export function parseApplet(value: unknown, stat: Stat = fileStat, nested = true): Applet | Refusal {
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
  const menu = fields.menu === undefined ? [] : parseMenu(fields.menu, where, nested);
  if (isRefusal(menu)) return menu;
  if (fields.click !== undefined && fields.click !== "activate" && fields.click !== "menu") return refuse(`${where}: click must be "activate" or "menu"`);
  const click = fields.click ?? (menu.length > 0 ? "menu" : "activate");
  if (click === "menu" && menu.length === 0) return refuse(`${where}: click is "menu" but there is no menu`);
  return {
    id: appletId,
    title,
    ...(glyph === undefined ? {} : { glyph }),
    ...(icon === undefined ? {} : { icon }),
    ...(label === undefined ? {} : { label }),
    ...(tooltip === undefined ? {} : { tooltip }),
    menu,
    click,
    attention: attention ?? false,
  };
}

function parseSize(fields: Record<string, unknown>): { width: number; height: number } | Refusal {
  const { minWidth, maxWidth, minHeight, maxHeight } = APPLET_LIMITS.popover;
  const width = integer(fields.width, "popover width", minWidth, maxWidth);
  if (isRefusal(width)) return width;
  const height = integer(fields.height, "popover height", minHeight, maxHeight);
  return isRefusal(height) ? height : { width, height };
}

/**
 * One line from an applet. `version` is the connection's: 1 until a hello
 * is accepted, then 2 or 3; version 1 refuses version 2's messages and
 * submenus, version 2 refuses version 3's.
 */
export function parseAppletMessage(line: string, stat: Stat = fileStat, version = 1): AppletMessage | Refusal {
  if (new TextEncoder().encode(line).byteLength > APPLET_LIMITS.line) return refuse(`a line is longer than ${APPLET_LIMITS.line} bytes`);
  const message = typedObject(line);
  if (isRefusal(message)) return message.error === "the message has no type" ? refuse('type must be "applet" or "remove"') : message;
  const { type, fields: raw } = message;
  switch (type) {
    case "hello": {
      const fields = record(raw, "hello", ["type", "protocol", "manifest", "dev"]);
      if (isRefusal(fields)) return fields;
      const protocol = integer(fields.protocol, "protocol", 2, 1000);
      if (isRefusal(protocol)) return protocol;
      const manifest = parseManifest(fields.manifest);
      if (isRefusal(manifest)) return refuse(`hello: ${manifest.error}`);
      const dev = optionalBoolean(fields.dev, "dev");
      if (isRefusal(dev)) return dev;
      return { type: "hello", protocol, manifest, dev: dev ?? false };
    }
    case "remove": {
      const fields = record(raw, "the message", ["type", "id"]);
      if (isRefusal(fields)) return fields;
      const appletId = id(fields.id, "id");
      return isRefusal(appletId) ? appletId : { type: "remove", id: appletId };
    }
    case "applet": {
      const fields = record(raw, "the message", ["type", "applet"]);
      if (isRefusal(fields)) return fields;
      const applet = parseApplet(fields.applet, stat, version >= 2);
      return isRefusal(applet) ? applet : { type: "applet", applet };
    }
    case "result":
    case "items":
    case "view":
      if (version < 3) return refuse(`“${type}” needs protocol 3: say hello with "protocol":3`);
      return parseCommandMessage(type, raw);
    case "power":
      if (version < 4) return refuse(`“power” needs protocol 4: say hello with "protocol":4`);
      return parsePowerAsk(raw);
    case "control": {
      if (version < 5) return refuse(`“control” needs protocol 5: say hello with "protocol":5`);
      const update = parseControlUpdate(raw);
      if (isRefusal(update) || update.glyph === undefined) return update;
      const glyph = parseGlyph(update.glyph);
      return isRefusal(glyph) ? refuse(`control “${update.id}”: ${glyph.error}`) : { ...update, glyph };
    }
    case "popover":
    case "dismiss": {
      if (version < 2) return refuse(`“${type}” needs protocol 2: send hello first`);
      if (type === "dismiss" && version >= 3 && raw.seq !== undefined) return parseCommandMessage("dismiss", raw);
      const fields = record(raw, type, type === "popover" ? ["type", "id", "width", "height"] : ["type", "id"]);
      if (isRefusal(fields)) return fields;
      const appletId = id(fields.id, "id");
      if (isRefusal(appletId)) return appletId;
      if (type === "dismiss") return { type: "dismiss", id: appletId };
      const size = parseSize(fields);
      return isRefusal(size) ? size : { type: "popover", id: appletId, ...size };
    }
    default:
      return refuse(
        version >= 5
          ? 'type must be "applet", "remove", "popover", "dismiss", "result", "items", "view", "power", or "control"'
          : version >= 4
            ? 'type must be "applet", "remove", "popover", "dismiss", "result", "items", "view", or "power"'
            : version >= 3
              ? 'type must be "applet", "remove", "popover", "dismiss", "result", "items", or "view"'
              : version >= 2
                ? 'type must be "applet", "remove", "popover", or "dismiss"'
                : 'type must be "applet" or "remove"',
      );
  }
}

const COMMAND_FIELDS = {
  result: ["type", "seq", "text", "copy", "open", "error"],
  items: ["type", "seq", "rows"],
  view: ["type", "seq", "height"],
  dismiss: ["type", "seq"],
} as const;

/** Version 3's messages about a command run (`seq`). */
function parseCommandMessage(type: keyof typeof COMMAND_FIELDS, raw: Record<string, unknown>): AppletMessage | Refusal {
  const checked = record(raw, type, COMMAND_FIELDS[type]);
  // A result may say `error` itself: only a new object is a refusal (record returns the message when it passes).
  if (checked !== raw && isRefusal(checked)) return checked;
  const fields = raw;
  const seq = integer(fields.seq, `${type}: seq`, 1, MAX_SEQ);
  if (isRefusal(seq)) return seq;
  switch (type) {
    case "result": {
      const result = parseResult(fields);
      return isRefusal(result) ? result : { type: "result", seq, result: result.result };
    }
    case "items": {
      const rows = parseRows(fields.rows);
      return isRefusal(rows) ? rows : { type: "items", seq, rows };
    }
    case "view": {
      const height = integer(fields.height, "view height", COMMAND_LIMITS.view.minHeight, COMMAND_LIMITS.view.maxHeight);
      return isRefusal(height) ? height : { type: "view", seq, height };
    }
    case "dismiss":
      return { type: "dismiss-view", seq };
  }
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** One line from the shell (the applet's side); null for anything else, so a newer shell's messages are skipped. */
export function parseAppletShellMessage(line: string): AppletShellMessage | null {
  const message = typedObject(line);
  if (isRefusal(message)) return null;
  const { type, fields } = message;
  if (type === "error") return typeof fields.message === "string" ? { type: "error", message: fields.message } : null;
  if (type === "welcome") return isNumber(fields.protocol) ? { type: "welcome", protocol: fields.protocol } : null;
  if (type === "power") {
    const state = parsePowerState(fields);
    return state ? { type: "power", ...state } : null;
  }
  if (type === "controls") {
    const shown = parseShown(fields);
    return shown ? { type: "controls", shown } : null;
  }
  if (type === "control-action") {
    const action = parseControlAction(fields);
    return action ? { type: "control-action", ...action } : null;
  }
  if (isNumber(fields.seq)) return parseRunMessage(type, fields, fields.seq);
  if (typeof fields.id !== "string") return null;
  if (type === "activate" && isNumber(fields.x) && isNumber(fields.y)) return { type: "activate", id: fields.id, x: fields.x, y: fields.y };
  if (type === "select" && typeof fields.item === "string") return { type: "select", id: fields.id, item: fields.item };
  if (type === "dismiss") return { type: "dismiss", id: fields.id };
  if (
    type === "popover" &&
    [fields.x, fields.y, fields.width, fields.height].every(isNumber) &&
    typeof fields.namespace === "string" &&
    (fields.output === null || typeof fields.output === "string")
  ) {
    return {
      type: "popover",
      id: fields.id,
      x: fields.x as number,
      y: fields.y as number,
      width: fields.width as number,
      height: fields.height as number,
      output: fields.output as string | null,
      namespace: fields.namespace,
    };
  }
  return null;
}

/** A shell message as it goes on the wire: `dismiss-view` is `{"type":"dismiss","seq"}`. */
export function wireMessage(message: AppletShellMessage): Record<string, unknown> {
  return message.type === "dismiss-view" ? { type: "dismiss", seq: message.seq } : { ...message };
}

const isArgValue = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** The shell's version 3 messages, each about a command run. */
function parseRunMessage(type: string, fields: Record<string, unknown>, seq: number): AppletShellMessage | null {
  if (type === "dismiss") return { type: "dismiss-view", seq };
  if (type === "run") {
    if (typeof fields.command !== "string") return null;
    const args = typeof fields.args === "object" && fields.args !== null && !Array.isArray(fields.args) ? (fields.args as Record<string, unknown>) : {};
    if (!Object.values(args).every(isArgValue)) return null;
    return {
      type: "run",
      seq,
      command: fields.command,
      args: args as Record<string, string | number | boolean>,
      ...(typeof fields.query === "string" ? { query: fields.query } : {}),
      ...(typeof fields.item === "string" ? { item: fields.item } : {}),
    };
  }
  if (
    type === "view" &&
    [fields.x, fields.y, fields.width, fields.height].every(isNumber) &&
    typeof fields.namespace === "string" &&
    (fields.output === null || typeof fields.output === "string")
  ) {
    return {
      type: "view",
      seq,
      x: fields.x as number,
      y: fields.y as number,
      width: fields.width as number,
      height: fields.height as number,
      output: fields.output as string | null,
      namespace: fields.namespace,
    };
  }
  return null;
}
