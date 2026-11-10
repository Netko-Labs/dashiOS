/** The screens arranging works on: those the compositor placed, with a usable area. */

import type { Output as Screen } from "../compositor.ts";
import type { Output } from "../layout.ts";

/** The screens that say where they are and what is usable (src/compositor/outputs.ts). */
export function placedOutputs(screens: readonly Screen[]): Output[] {
  return screens.flatMap((screen) =>
    screen.frame && screen.usable ? [{ name: screen.name, frame: screen.frame, usable: screen.usable, scale: screen.scale }] : [],
  );
}
