/**
 * The palette the panes paint their own parts with, in Control Center's
 * tokens (docs/design.html, "Settings"): @dashi/ui's names, so a pane's
 * words, hairlines and fills follow the cards they sit on. Text is the off
 * tile's ink, quieter text the muted ink, hairlines and tracks the line,
 * a secondary fill the knob's, "chosen" Dashi green (it is on), a primary
 * button the slider's ink fill and its words, and the ring @dashi/ui's own
 * purple. The job colors (ume, broth, shiso) stay @dashi/ui's.
 */

import { type Palette, useColors as usePalette } from "@dashi/ui";
import { useControlColors } from "../shared/controls/palette.ts";

export function useColors(): Palette {
  const palette = usePalette();
  const colors = useControlColors();
  return {
    ...palette,
    text: colors.offInk,
    textMuted: colors.muted,
    separator: colors.line,
    button: colors.knobOff,
    track: colors.line,
    selection: colors.on,
    primary: colors.fill,
    onPrimary: colors.fillInk,
    focusRing: colors.focus,
  };
}
