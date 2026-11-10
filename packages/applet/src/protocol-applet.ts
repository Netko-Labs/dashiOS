/** The applet → shell direction of the applets channel (protocol.ts): the applet, its glyph and icon, and each message an applet sends. */

import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { id, integer, isRefusal, optionalBoolean, type Refusal, record, refuse, text, typedObject } from "@dashi/shape/kit";
import { COMMAND_LIMITS, parseResult, parseRows } from "./commands.ts";
import { parseControlUpdate } from "./controls.ts";
import { parseManifest } from "./manifest.ts";
import { parseMenu } from "./menu.ts";
import { parsePowerAsk } from "./power.ts";
import { APPLET_LIMITS, type Applet, type AppletMessage, MAX_SEQ } from "./protocol-types.ts";

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
