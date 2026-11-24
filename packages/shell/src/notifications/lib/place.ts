/** Where the notification area sits, and what it is given. */

import { SPACE } from "@dashi/ui";
import type { NotificationStore } from "../store.ts";

/** The air between the area and the Dock (or the screen's edge). */
const AREA_AIR = SPACE.m;

/** Where the area ends above the screen's bottom edge: over the Dock's or the taskbar's zone, which stays visible under it. */
export const areaBottom = (dockInset: number): number => Math.max(0, dockInset) + AREA_AIR;

export interface AreaPlace {
  store: NotificationStore;
  onClose: () => void;
  /** Esc: closed, or back to the menu bar when the keyboard came from it (menus/bar-keys.ts). */
  onEscape?: () => void;
  /** How tall the Dock's zone at the screen's bottom is now (dock/presenter.ts `bottomInset`); 0 when it is hidden or autohides. */
  dockInset: number;
}
