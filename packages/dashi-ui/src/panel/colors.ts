/**
 * The panel look's colours as the shell reads them: the theme's
 * (@dashi/ui ControlPalette, with the one "on") in the mode and accent in use,
 * a menu's lit row in them, and a floating panel's edge.
 */

import { createContext } from "react";
import type { MenuHighlight } from "../menu-row.tsx";
import { type ControlPalette, controlPalette, DARK_CONTROLS, useAccent, useDark } from "../theme/index.ts";

export function useControlColors(): ControlPalette {
  return controlPalette(useDark(), useAccent());
}

/**
 * Whether a panel control sits on a card. Settings' cards (and the
 * Installer's) are the off colour, the ground a panel field has elsewhere, so
 * a field there would vanish into its card: the card says so, and the field
 * sinks to the window's colour instead, as a list sunk in a card does (SE-8).
 */
export const OnPanelCard = createContext(false);

/** A panel field's ground: the off colour on the panel or a sidebar; the window's, sunk into a card. */
export const panelFieldGround = (palette: ControlPalette, onCard: boolean): string => (onCard ? palette.window : palette.off);

/**
 * A menu's lit row in these surfaces: the chosen pill's green and its ink, so
 * a "More" menu under a row of pills lights the way the pills do (one green
 * side by side, not kombu beside the light Dark green).
 */
export const controlMenuHighlight = (palette: ControlPalette): MenuHighlight => ({
  fill: palette.on,
  ink: palette.onInk,
  keysInk: `${palette.onInk}cc`,
});

/**
 * A floating panel's edge and padding: in Light, only the padding, since its
 * shadow separates it; on true black, where a shadow has nothing to darken, a
 * 1 px hairline as well. The hairline is a border, so it takes its width out of
 * the padding: the content box is the same in both modes, and the rows that
 * are sized from the panel's width (`GRID.width - 2 * GRID.padding`) still fit
 * it instead of being cut at their right end.
 */
export interface PanelEdge {
  padding: number;
  borderWidth?: number;
  borderColor?: string;
}

/** The hairline's width on true black. */
export const PANEL_EDGE_WIDTH = 1;

export const panelEdge = (dark: boolean, padding: number): PanelEdge =>
  dark ? { padding: padding - PANEL_EDGE_WIDTH, borderWidth: PANEL_EDGE_WIDTH, borderColor: DARK_CONTROLS.line } : { padding };

/** The edge and padding of Control Center and the battery panel in the mode in use. */
export function usePanelEdge(padding: number): PanelEdge {
  return panelEdge(useDark(), padding);
}
