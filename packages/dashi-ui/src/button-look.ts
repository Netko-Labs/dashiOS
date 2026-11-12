/**
 * How a push button is painted in each state (UI-4): a fill at rest, under
 * the pointer, and held down; its edge; its ink. Ink goes ahead (`primary`:
 * the ink under light words in Light, the light ink under black words in
 * Dark), ume destroys, and a secondary button is the quiet fill with a 3:1
 * edge. Kombu is no button's: green means on. Ume and a chosen pill deepen
 * under the pointer and while held; ink steps toward the page (lighter in
 * Light, dimmer in Dark), since ink to black can't be seen.
 * Disabled changes nothing here: the whole button is drawn at 40%
 * (`DISABLED_OPACITY`), so a disabled primary still reads as primary.
 */

import type { Palette } from "./theme/palette.ts";

/** `chosen` is a pill that is the one picked (choices.tsx): kombu, since it is on, not a button that goes ahead. */
export type ButtonKind = "secondary" | "primary" | "danger" | "chosen";

export interface ButtonLook {
  fill: string;
  hover: string;
  edge: string;
  edgeWidth: number;
  ink: string;
  weight: "normal" | "semibold";
}

/**
 * The look of a `kind` button. `isDefault` gives a secondary one a 2 px ink
 * edge, the primary button's own color: it is what Enter presses. Not purple,
 * which is where the keyboard is (KB-2), and not kombu, which is on.
 */
export function buttonLook(
  colors: Palette,
  kind: ButtonKind,
  { pressed = false, isDefault = false }: { pressed?: boolean; isDefault?: boolean } = {},
): ButtonLook {
  if (kind !== "secondary") {
    const fills = {
      danger: { rest: colors.umeFill, over: colors.umeFillHover, held: colors.umeFillPressed, ink: "#ffffff" },
      chosen: { rest: colors.selection, over: colors.selectionHover, held: colors.selectionPressed, ink: "#ffffff" },
      primary: { rest: colors.primary, over: colors.primaryHover, held: colors.primaryPressed, ink: colors.onPrimary },
    } as const;
    const { rest, over, held, ink } = fills[kind];
    const fill = pressed ? held : rest;
    return { fill, hover: pressed ? held : over, edge: fill, edgeWidth: 1, ink, weight: "semibold" };
  }
  const fill = pressed ? colors.pressed : colors.button;
  return {
    fill,
    hover: pressed ? colors.pressed : colors.separator,
    edge: isDefault ? colors.primary : colors.controlEdge,
    edgeWidth: isDefault ? 2 : 1,
    ink: colors.text,
    weight: "normal",
  };
}
