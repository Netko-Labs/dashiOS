/**
 * A floating panel on glass (design.html DE-4, DE-2; D781): the compositor draws its rim and hairline,
 * so the panel takes no border of its own where glass is drawn; the true-black hairline (`panelEdge`)
 * stays for a host that draws none.
 */

import { type PanelEdge, panelEdge, useDark } from "@dashi/ui";
import { useWindowGlass } from "@mirinjs/metal";

/** The panel's edge and padding: padding only under glass, else the kit's true-black edge. */
export function glassPanelEdge(dark: boolean, padding: number, glass: boolean): PanelEdge {
  return glass ? { padding } : panelEdge(dark, padding);
}

/** `glassPanelEdge` in the mode in use, for the host it is drawn on. */
export function useGlassPanelEdge(padding: number): PanelEdge {
  return glassPanelEdge(useDark(), padding, useWindowGlass().available);
}
