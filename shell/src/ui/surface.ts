/**
 * The grounds Dashi's windows paint on: System Settings and the first-party
 * apps. A window is opaque (it has nothing to see through), so these are solid
 * colors chosen from the palette in use; the shell's own glass (menus, the
 * Dock) paints from the palette directly.
 */

import { darkColors, useColors } from "../theme.ts";

export interface Surface {
  window: string;
  sidebar: string;
  /** A grouped card of rows. */
  card: string;
  /** A text field, or a list sunk into a card. */
  field: string;
  /** Every other row of a table (macOS's alternating rows). */
  stripe: string;
}

export const LIGHT_SURFACE: Surface = { window: "#f5f5f7", sidebar: "#e8e8ec", card: "#ffffff", field: "#f0f0f3", stripe: "#f4f4f6" };
export const DARK_SURFACE: Surface = { window: "#1e1e20", sidebar: "#29292c", card: "#2c2c2f", field: "#232326", stripe: "#252528" };

export function useSurface(): Surface {
  return useColors() === darkColors ? DARK_SURFACE : LIGHT_SURFACE;
}
