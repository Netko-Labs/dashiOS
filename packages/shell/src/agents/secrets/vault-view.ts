/**
 * Whether the vault is on screen: Settings' Passwords pane says so while it
 * shows, and agents' pictures blank the Settings window meanwhile (mask.ts).
 */

import { SETTINGS_APP_ID } from "../../apps.ts";
import type { CompositorWindow } from "../../compositor/index.ts";

let showing = 0;

/** The Passwords pane appeared; the returned function says it went. */
export function vaultShown(): () => void {
  showing++;
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    showing--;
  };
}

/** Whether `window` shows the vault now. */
export function isVaultWindow(window: Pick<CompositorWindow, "appId">): boolean {
  return showing > 0 && window.appId === SETTINGS_APP_ID;
}
