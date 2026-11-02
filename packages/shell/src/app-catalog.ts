/**
 * The installed apps the Dock and the menu bar name windows by. They are read
 * at login (entries.ts) and again when a window shows up whose app id none of
 * them matches. An app installed since then (Software, flatpak, dnf) gets its
 * icon and name with its first window, not at the next login: Zed installed
 * from Flathub during a session sat in the Dock with the generic icon. Each
 * unknown app id is looked for once, so a window that matches nothing (a
 * nested compositor, a script's window) costs a single rescan.
 *
 * `entries` is one array for the whole shell, refilled in place, so every
 * holder (the Dock, the menu bar, attention) sees the new apps; `notice`
 * runs before the window list is published (toplevels.ts), so the render
 * that shows the window already has its app.
 */

import { matchEntry } from "./dock/layout.ts";
import { type Entry, loadEntries } from "./entries.ts";

export class AppCatalog {
  readonly entries: Entry[];
  private readonly looked = new Set<string>();

  /** With the hidden entries: they name windows (an app's NoDisplay entry for its own app id), though nothing lists them. */
  constructor(private readonly load: () => Entry[] = () => loadEntries({ withHidden: true })) {
    this.entries = load();
  }

  /** A window with `appId` was reported: rescan if no app matches it and it hasn't been looked for. True if it matches one now. */
  notice(appId: string): boolean {
    if (!appId) return false;
    if (matchEntry(this.entries, appId)) return true;
    if (this.looked.has(appId)) return false;
    this.looked.add(appId);
    this.entries.splice(0, this.entries.length, ...this.load());
    return matchEntry(this.entries, appId) !== undefined;
  }
}
