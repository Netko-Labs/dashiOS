/**
 * An app's icon as a picture: the file its entry names, or the generic icon
 * when the host cannot draw that file (an XPM, a TIFF, a path that is gone).
 * The host says so itself (`Picture`, @dashi/ui), so nothing reads the file
 * first (decisions.md D133).
 */

import { Picture, type PictureProps } from "@dashi/ui";
import { Image } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { iconPath } from "./list.ts";

export function AppIcon({ source, resizeMode, style }: Pick<PictureProps, "source" | "resizeMode" | "style">): ReactNode {
  const generic = iconPath("generic");
  const look = { ...(resizeMode ? { resizeMode } : {}), ...(style ? { style } : {}) };
  return <Picture source={source} {...look} fallback={source === generic ? null : <Image source={generic} {...look} />} />;
}
