/** An installed app as the launcher, the Dock and Activity Monitor see it (entries.ts). */

import type { App, DesktopAction } from "../apps/index.ts";
import type { Localized } from "../locale/index.ts";

export interface Entry extends App {
  /** Other words people search for ("browser" for Firefox). */
  keywords: string[];
  /** Words it answers to only when nothing else matches ("settings" for a Settings pane; launcher/ranking/). */
  fallbackKeywords?: string[];
  /** A one-color SVG drawn on a neutral tile instead of `icon` (a Settings pane's glyph). */
  glyph?: string;
  /** A few muted words after the name, on the same line ("Web Browser", "Dark Mode, accent, corners"). */
  detail?: string;
  /** The app id its windows use when it differs from the desktop id. */
  wmClass?: string;
  /** One of the shell's own apps (System Settings): it wins ties in search over an installed app of the same words. */
  shell?: true;
  /**
   * `NoDisplay=true`: not listed (the launcher, search), but still the app its
   * windows belong to. Apps often keep the entry that names their windows
   * hidden beside a visible one (T3 Code's `com.t3tools.T3Code` beside
   * `t3code-nightly`), as GNOME and KDE allow.
   */
  hidden?: true;
  /** Its Name[xx], GenericName[xx] and Keywords[xx] in the person's language, for the ranking (launcher/ranking/). */
  localized?: Localized;
  /** Its `[Desktop Action]` groups ("New Private Window"): commands of the app in the action registry (actions/). */
  actions?: DesktopAction[];
  /** `Terminal=true` (htop): it runs in a terminal window, so `exec` starts the pinned Terminal with it (`loadEntries`). */
  terminal?: true;
}
