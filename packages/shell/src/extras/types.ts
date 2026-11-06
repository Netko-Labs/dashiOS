/**
 * Menu bar extras: the items other programs put in the menu bar's status
 * area, left of Dashi's own (battery, network, volume, Control Center). Two
 * sources feed them, and the bar draws both the same way:
 *
 * - `tray`: StatusNotifierItem over D-Bus (tray/), what Steam, Discord,
 *   Nextcloud, and most Linux apps with a tray icon speak;
 * - `applet`: Dashi's own applet protocol (applets/, docs/applets.md), for
 *   programs written for Dashi: a glyph tinted like the bar's own, or text.
 *
 * An extra says what to draw and how to answer a click; its menu is read
 * when it opens (a tray item's dbusmenu changes under it).
 */

/** What the bar draws for an extra. */
export type ExtraIcon =
  /** SVG markup drawn as a template: every fill and stroke in the bar's text color, as Dashi's own glyphs. */
  | { kind: "glyph"; markup: string }
  /** A picture as it is (a PNG or SVG file): a tray icon from the icon theme or the app's pixmap. */
  | { kind: "image"; path: string };

/** A row of an extra's menu. Submenus come flattened, under a heading row (`depth` > 0 indents). */
export type ExtraMenuRow =
  | { kind: "separator" }
  | {
      kind: "item";
      /** Unique within the menu; what a choice reports back. */
      id: string;
      label: string;
      enabled: boolean;
      /** Present puts a check gutter in the menu; true draws the check. */
      checked?: boolean;
      /** A submenu's heading: shown, never chosen. */
      heading?: boolean;
      depth?: number;
    };

export interface MenuBarExtra {
  /** Stable while the extra lives: `tray:<bus name><path>` or `applet:<connection>/<id>`. */
  key: string;
  source: "tray" | "applet";
  /** Who it is, for the tooltip and accessibility: the app's name or the applet's title. */
  title: string;
  icon: ExtraIcon | null;
  /** Text beside (or instead of) the icon, as the battery's percentage. */
  label?: string;
  tooltip?: string;
  /** Asks for the person's attention (a tray item's NeedsAttention): the bar marks it. */
  attention: boolean;
  /** A primary click opens the menu instead of activating (StatusNotifierItem's ItemIsMenu, or an applet with a menu and no activate). */
  menuOnClick: boolean;
  /** Whether a secondary click has a menu to open. */
  hasMenu: boolean;
  /** An applet run by `dashi-applet dev`: the bar marks it "dev". */
  dev?: boolean;
}

/** What the menu bar can ask of an extra; the source that made it carries it out. */
export interface ExtraActions {
  /** A primary click at (x, y) in screen pixels, on the screen named `output` when the bar knows it. */
  activate(key: string, x: number, y: number, output?: string): void;
  /** A middle click. */
  secondaryActivate(key: string, x: number, y: number): void;
  /** The menu to show now (a tray item is asked to update it first); empty when there is none. */
  menu(key: string): Promise<readonly ExtraMenuRow[]>;
  /** A row of that menu was chosen. */
  choose(key: string, id: string): void;
  /** The menu that was open closed (dbusmenu wants to know). */
  menuClosed?(key: string): void;
}
