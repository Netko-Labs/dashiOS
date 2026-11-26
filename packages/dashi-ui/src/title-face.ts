/**
 * A title's face (TY-2, decisions.md D720): words at 20 and up are Inter Display SemiBold, drawn for
 * those sizes. Only a host that says `displayFont` is sent the family (an older one refuses the tree);
 * with any other, the title is Inter SemiBold.
 */

import { type TextStyle, useHostProtocol } from "@mirinjs/metal";
import { WEIGHT } from "./theme/index.ts";

/** The face for a title of 20 and up, given whether the host draws Inter Display. */
export function titleFace(display: boolean): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  return display ? { fontFamily: "display", fontWeight: WEIGHT.semibold } : { fontWeight: WEIGHT.semibold };
}

/** The face for a title of 20 and up on this surface's host. */
export function useTitleFace(): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  return titleFace(useHostProtocol()?.displayFont === true);
}
