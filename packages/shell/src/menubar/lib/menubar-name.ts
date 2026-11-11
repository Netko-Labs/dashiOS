/**
 * The name the menu bar shows beside the Dashi menu: the app in front, a
 * portal dialog's, or what it was while a menu or a sheet holds the keyboard.
 */

import { useRef } from "react";
import { appFor } from "../../apps.ts";
import type { App } from "../../shared/apps/index.ts";
import { type ToplevelStore, useClipboardHelperActive, usePortalDialogs, useToplevels } from "../../toplevels.ts";
import { barHold, useBarHeld } from "../bar-hold.ts";
import { type BarName, barName, DESKTOP } from "./bar-name.ts";

/** `frozenName` is the name an open menu holds (menus/), or null. */
export function useBarName(
  apps: readonly App[],
  toplevels: ToplevelStore,
  installed: ((appId: string) => App | undefined) | undefined,
  frozenName: string | null,
): string {
  const windows = useToplevels(toplevels);
  const active = windows.find((window) => window.activated);
  // A portal dialog with the keyboard is named for the app it is over, or by its title (bar-name.ts).
  const dialog = usePortalDialogs(toplevels).find((window) => window.activated);
  // An open menu holds the keyboard, which leaves no window active: the name stays as it was.
  // So does a shell sheet that took the keyboard for the app in front (bar-hold.ts).
  const sheetUp = useBarHeld(barHold);
  // wl-copy's window has the keyboard for a moment while an app copies or pastes: the app is still in front.
  const copying = useClipboardHelperActive(toplevels);
  const kept = useRef<BarName>({ name: DESKTOP });
  if (!sheetUp && !copying && frozenName === null) {
    const focus = { ...(active ? { app: appFor(apps, active, installed).name } : {}), ...(dialog ? { dialog: dialog.title } : {}) };
    kept.current = barName(focus, kept.current, Date.now());
  }
  return frozenName ?? kept.current.name;
}
