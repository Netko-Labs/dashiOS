/**
 * How a push button is painted in each state (UI-4): a fill at rest, under
 * the pointer, and held down; its edge; its ink. Kombu goes ahead, ume
 * destroys, and a secondary button is the quiet fill with a 3:1 edge.
 * Disabled changes nothing here: the whole button is drawn at 40%
 * (`DISABLED_OPACITY`), so a disabled primary still reads as primary.
 */

import type { Palette } from "./theme/palette.ts";

export type ButtonKind = "secondary" | "primary" | "danger";

export interface ButtonLook {
  fill: string;
  hover: string;
  edge: string;
  edgeWidth: number;
  ink: string;
  weight: "normal" | "semibold";
}

/** The look of a `kind` button; `isDefault` rings a secondary one in kombu (it is what Enter presses). */
export function buttonLook(
  colors: Palette,
  kind: ButtonKind,
  { pressed = false, isDefault = false }: { pressed?: boolean; isDefault?: boolean } = {},
): ButtonLook {
  if (kind === "primary" || kind === "danger") {
    const [rest, over, held] =
      kind === "danger" ? [colors.umeFill, colors.umeFillHover, colors.umeFillPressed] : [colors.selection, colors.selectionHover, colors.selectionPressed];
    const fill = pressed ? held : rest;
    return { fill, hover: pressed ? held : over, edge: fill, edgeWidth: 1, ink: "#ffffff", weight: "semibold" };
  }
  const fill = pressed ? colors.pressed : colors.button;
  return {
    fill,
    hover: pressed ? colors.pressed : colors.separator,
    edge: isDefault ? colors.selection : colors.controlEdge,
    edgeWidth: isDefault ? 2 : 1,
    ink: colors.text,
    weight: "normal",
  };
}
