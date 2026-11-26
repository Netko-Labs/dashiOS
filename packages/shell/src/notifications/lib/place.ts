/** Where the notification area sits, and what it is given. */

import { SPACE } from "@dashi/ui";
import { COLUMN_WIDTH, galleryFit } from "../../widgets/index.ts";
import type { NotificationStore } from "../store.ts";
import { AREA, COLUMN_RIGHT } from "./area.ts";

/** The air between the area and the Dock (or the screen's edge). */
const AREA_AIR = SPACE.m;

/** Where the area ends above the screen's bottom edge: over the Dock's or the taskbar's zone, which stays visible under it. */
export const areaBottom = (dockInset: number): number => Math.max(0, dockInset) + AREA_AIR;

/** Between the banners' lane and the widget column beside it (Frost v2: 1274 − 12 − 356). */
const LANE_GAP = SPACE.inset;

/**
 * The banners' lane (NO-6, D729): how far a banner's panel stands from the screen's right edge. With the
 * widget column showing, the column just left of it, so a banner never covers or moves a widget; without
 * it, the column's own place at the screen's edge. Top-aligned with the column either way.
 */
export function bannerLane(columnShown: boolean): number {
  return columnShown ? COLUMN_RIGHT + COLUMN_WIDTH + LANE_GAP : COLUMN_RIGHT;
}

/** The widget gallery beside the column: this far left of it, this far down; and the least it keeps from the screen's left edge. */
const GALLERY_AT = { beside: 26, down: 30, edge: SPACE.inset } as const;

export interface GalleryPlace {
  right: number;
  top: number;
  width: number;
  list: number;
}

/**
 * Where the widget gallery goes on a screen `screenWidth` wide (null before
 * it is known): beside the column, 700 wide. A narrower screen narrows its
 * list first (galleryFit); one too narrow even for that moves it left over
 * the column, never past the screen's left edge.
 */
export function galleryPlace(screenWidth: number | null): GalleryPlace {
  const beside = AREA.right + COLUMN_WIDTH + GALLERY_AT.beside;
  const top = AREA.top + GALLERY_AT.down;
  if (screenWidth === null) return { right: beside, top, ...galleryFit(Number.POSITIVE_INFINITY) };
  const fit = galleryFit(screenWidth - beside - GALLERY_AT.edge);
  return { right: Math.max(AREA.right, Math.min(beside, screenWidth - fit.width - GALLERY_AT.edge)), top, ...fit };
}

export interface AreaPlace {
  store: NotificationStore;
  onClose: () => void;
  /** Esc: closed, or back to the menu bar when the keyboard came from it (menus/bar-keys.ts). */
  onEscape?: () => void;
  /** How tall the Dock's zone at the screen's bottom is now (dock/presenter.ts `bottomInset`); 0 when it is hidden or autohides. */
  dockInset: number;
  /** The screen's width, for the widget gallery's place (null until it is known). */
  screenWidth?: number | null;
}
