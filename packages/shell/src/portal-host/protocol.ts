/**
 * How dashi-portal (apps/portal/) and the shell talk: the shell owns
 * `dev.dashi.Shell` on the session bus and serves `dev.dashi.Shell.Portal1`
 * at `/dev/dashi/Shell` for what only the shell can do: hold the screen awake
 * (idle is the shell's), hang a dialog from an app's window (window
 * placement is the shell's, through the compositor), and add a web app to
 * the Dock. Both sides import these names from here.
 *
 *   Inhibit(s app_id, s reason, u flags) → u id      flags as the portal's
 *   Uninhibit(u id)
 *   ExpectSheet(s title, s parent_window)            the window titled `title` that dashi-portal opens next is a sheet on `parent_window`
 *   AddToDock(s app_id, s name)                      the launcher an app installs next (DynamicLauncher) goes in the Dock
 *
 * Only the owner of the portal's own name may call ExpectSheet and AddToDock.
 */

export const SHELL_NAME = "dev.dashi.Shell";
export const SHELL_PATH = "/dev/dashi/Shell";
export const PORTAL_HOST = "dev.dashi.Shell.Portal1";

/** The bus name dashi-portal owns (and xdg-desktop-portal calls). */
export const PORTAL_BACKEND = "org.freedesktop.impl.portal.desktop.dashi";

/** The app id of every window dashi-portal opens. */
export const PORTAL_APP_ID = "dev.dashi.portal";

/** The first title of a dialog window: how the shell knows which window is which sheet. */
export const sheetTitle = (token: string): string => `dashi-portal:${token}`;

const SHEET_TITLE = /^dashi-portal:[A-Za-z0-9_]{1,64}$/;
export const isSheetTitle = (title: string): boolean => SHEET_TITLE.test(title);

/** A portal parent window as xdg-desktop-portal passes it: `wayland:HANDLE` or `x11:XID`; anything else is no parent. */
export function parseParentWindow(text: string): string | null {
  if (/^wayland:[A-Za-z0-9_-]{1,128}$/.test(text)) return text;
  if (/^x11:(0x)?[0-9a-fA-F]{1,8}$/.test(text)) return text;
  return null;
}
