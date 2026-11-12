/**
 * The name the menu bar shows after the Dashi menu: the focused window's
 * app, or "Desktop" with none. A portal dialog (an Access question, a file
 * chooser) is no app's window (toplevels.ts), so with one in front no app
 * window is active; the bar names the app it came up over, as it does for
 * the app's own sheet, or, over the desktop, the dialog itself by its title.
 */

import { isSheetTitle } from "../../shared/portal-host/index.ts";

export const DESKTOP = "Desktop";

/**
 * Focus passes from an app's window to a dialog in two reports (the window
 * lets go, then the dialog takes it); for this long between them the
 * desktop doesn't count as having been in front.
 */
export const HANDOVER_MS = 500;

export interface BarFocus {
  /** The focused app window's app name, if one is focused. */
  app?: string;
  /** The title of the portal dialog that has the keyboard, if one has. */
  dialog?: string;
}

export interface BarName {
  name: string;
  /** The app last in front: a dialog that comes next is over it. */
  under?: string;
  /** Since when nothing has had the keyboard (ms). */
  desktopSince?: number;
}

/** The bar's name for what has the keyboard `now`, after `last` (the previous answer). */
export function barName({ app, dialog }: BarFocus, last: BarName, now: number): BarName {
  if (app !== undefined) return { name: app, under: app };
  if (dialog === undefined) {
    const desktopSince = last.desktopSince ?? now;
    return { name: DESKTOP, ...(last.under !== undefined && now - desktopSince < HANDOVER_MS ? { under: last.under } : {}), desktopSince };
  }
  const over = last.under !== undefined && (last.desktopSince === undefined || now - last.desktopSince < HANDOVER_MS) ? last.under : undefined;
  if (over !== undefined) return { name: over, under: over };
  // A sheet's one-off first title (shared/portal-host/protocol.ts) is no name.
  return { name: isSheetTitle(dialog) ? DESKTOP : dialog.trim() || DESKTOP };
}
