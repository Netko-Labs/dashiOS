/**
 * The applets channel, `$XDG_RUNTIME_DIR/dashi-applets.sock`: how a program
 * puts its own items in the menu bar's status area (docs/applets.md).
 * Newline-delimited JSON, one message per line.
 *
 * The protocol (both versions, the parsers, the limits) lives in
 * @dashi/applet, so an applet's client refuses what the shell would; this is
 * the shell's facade for it, plus what only the shell decides: how a
 * menu with submenus reads in the bar's one-level dropdown.
 *
 *   applet → shell  hello (v2, first), applet, remove, popover (v2), dismiss (v2)
 *   shell → applet  welcome (v2), activate, select, error, popover (v2: where), dismiss (v2)
 *
 * What arrives is untrusted: unknown fields, wrong types, and anything over
 * the limits refuse the whole message; a glyph may not reach outside itself
 * (no images, links, entities, scripts, or styles).
 */

import type { AppletMenuRow } from "@dashi/applet";
import type { ExtraMenuRow } from "../extras/index.ts";

export {
  APPLET_LIMITS,
  APPLETS_SOCKET,
  type Applet,
  type AppletMenuRow,
  type AppletMessage,
  type AppletShellMessage,
  appletsSocketPath,
  type Placement,
  PROTOCOL,
  parseApplet,
  parseAppletMessage,
  parseAppletShellMessage,
} from "@dashi/applet";

/**
 * An applet's rows as the bar's dropdown takes them: a submenu becomes a
 * heading with its rows indented under it, as a tray item's do. A row in a
 * disabled submenu is disabled.
 */
export function flattenRows(rows: readonly AppletMenuRow[]): ExtraMenuRow[] {
  const out: ExtraMenuRow[] = [];
  flattenInto(rows, 0, true, out, { headings: 0 });
  return out;
}

function flattenInto(rows: readonly AppletMenuRow[], depth: number, enabled: boolean, out: ExtraMenuRow[], count: { headings: number }): void {
  for (const row of rows) {
    if (row.kind === "separator") out.push(row);
    else if (row.kind === "item")
      out.push({
        kind: "item",
        id: row.id,
        label: row.label,
        enabled: enabled && row.enabled,
        ...(row.checked === undefined ? {} : { checked: row.checked }),
        ...(depth > 0 ? { depth } : {}),
      });
    else {
      // A heading is shown, never chosen (choose() looks the id up in the applet's own rows).
      out.push({ kind: "item", id: `submenu:${count.headings++}`, label: row.label, enabled: false, heading: true, ...(depth > 0 ? { depth } : {}) });
      flattenInto(row.rows, depth + 1, enabled && row.enabled, out, count);
    }
  }
}
